import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { npm } from '../scripts/npm.mjs';
import { commitRoot, git } from '../src/proof.mjs';
import { encodeBackupAnchor, refsCommitment, sha256 } from '../src/anchor.mjs';
import { ccc } from '../runtime/ckb.cjs';
import { mappingDigest, mappingAnchorData } from '../src/attribution.mjs';

test('packed CLI installs offline and logs in, detects another project, backs up and restores after source deletion', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivet-package-'));
  let server;
  try {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const cache = join(directory, 'cache'), prefix = join(directory, 'installed');
    const packed = JSON.parse((await npm(['pack', '--offline', '--ignore-scripts', '--json', '--cache', cache,
      '--pack-destination', directory], { cwd: packageRoot })).stdout)[0];
    assert.ok(packed.files.every(file => /^(src\/|runtime\/|package\.json$|README\.md$|LICENSE$)/.test(file.path)), 'Only runtime files and package documentation ship');
    await npm(['install', '--global', '--prefix', prefix, '--cache', cache, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, packed.filename)]);
    const installed = process.platform === 'win32' ? join(prefix, 'node_modules', '@rivet', 'cli') : join(prefix, 'lib', 'node_modules', '@rivet', 'cli');
    const native = process.env.RIVET_TEST_BINARY;
    const executable = native || join(installed, 'src', 'cli.mjs');
    const shim = native || (process.platform === 'win32' ? join(prefix, 'rivet.cmd') : join(prefix, 'bin', 'rivet'));
    await access(shim);
    await access(join(installed, 'runtime', 'ckb.cjs'));
    const version = process.platform === 'win32' && !native
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${shim}" --version"`], { encoding: 'utf8', windowsVerbatimArguments: true })
      : execFileSync(shim, ['--version'], { encoding: 'utf8' });
    assert.match(version, /^rivet 0\.1\.0/);

    const project = join(directory, 'original'), bundle = join(directory, 'source.bundle'), encryptedFile = join(directory, 'encrypted.bundle');
    await git(['init', '--initial-branch=main', project]);
    await git(['config', 'user.name', 'Package recovery'], project); await git(['config', 'user.email', 'package@example.test'], project);
    await writeFile(join(project, 'readme'), 'installed CLI recovery\n');
    await git(['add', '.'], project); await git(['commit', '-m', 'snapshot'], project);
    await git(['branch', 'feature'], project); await git(['tag', '-a', 'v1', '-m', 'release'], project);
    await git(['remote', 'add', 'origin', 'git@github.com:Owner/project.git'], project);
    await git(['bundle', 'create', bundle, '--all'], project);
    const commits = (await git(['log', '--all', '--format=%H'], project)).stdout.trim().split('\n');
    const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)'], project)).stdout.trim().split('\n');
    const bytes = await readFile(bundle), key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    await writeFile(encryptedFile, Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]));
    const txHash = `0x${'ab'.repeat(32)}`, blockHash = `0x${'cd'.repeat(32)}`;
    const proof = { protocol: 'rivet-backup-proof-v2', network: 'ckb-testnet', repository: 'Owner/project', txHash, outputIndex: 0,
      merkleRoot: commitRoot([...commits].sort()), refsHash: refsCommitment(refs), bundleSha256: sha256(bytes), commitCount: commits.length,
      ipfsCid: `bafy${'a'.repeat(40)}`, encryptionKey: key.toString('hex'), encryptionIv: iv.toString('hex') };
    let mappingTransaction;
    server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      const url = new URL(request.url, 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname.startsWith('/api/')) {
        assert.equal(request.headers.authorization, 'Bearer disposable_package_token');
        if (url.pathname === '/api/cli/account') { response.end(JSON.stringify({ githubId: '1001', username: 'Developer' })); return; }
        if (url.pathname === '/api/cli/backup') {
          assert.equal(JSON.parse(body).repoFullName, proof.repository);
          response.end(JSON.stringify({ accepted: true, startedAt: '2026-11-10T12:00:00Z', previousTxHash: null })); return;
        }
        assert.equal(url.pathname, '/api/cli/status'); assert.equal(url.searchParams.get('repo'), proof.repository);
        response.end(JSON.stringify({ status: 'confirmed', proof })); return;
      }
      assert.equal(url.pathname, '/rpc'); assert.equal(request.headers.authorization, undefined);
      const { id, method, params } = JSON.parse(body); assert.ok(['get_transaction', 'get_header', 'get_blockchain_info'].includes(method));
      const isMapping = mappingTransaction && params[0] === mappingTransaction.hash();
      response.end(JSON.stringify({ jsonrpc: '2.0', id, result: method === 'get_blockchain_info' ? { chain: 'ckb_testnet' }
        : method === 'get_header' ? { number: '0x2a', hash: blockHash } : {
          tx_status: { status: 'committed', block_hash: blockHash }, transaction: isMapping ? {
            hash: mappingTransaction.hash(), version: '0x0', cell_deps: [], header_deps: [], inputs: [], witnesses: [], outputs_data: mappingTransaction.outputsData,
            outputs: mappingTransaction.outputs.map(output => ({ capacity: `0x${output.capacity.toString(16)}`, lock: {
              code_hash: output.lock.codeHash, hash_type: output.lock.hashType, args: output.lock.args } })),
          } : { hash: proof.txHash, outputs_data: [encodeBackupAnchor(proof)] },
        } }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const serverUrl = `http://127.0.0.1:${server.address().port}`, rpcUrl = `${serverUrl}/rpc`;
    const env = { ...process.env, NODE_OPTIONS: '', RIVET_CONFIG_DIR: join(directory, 'settings') };
    delete env.RIVET_TOKEN; delete env.RIVET_URL;
    const run = async (args, cwd, extra = {}) => {
      const execution = exec(process.platform === 'win32' && !native ? process.execPath : shim, process.platform === 'win32' && !native ? [executable, ...args] : args,
        { cwd, env, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], ...extra });
      execution.child.stdin.end(extra.input || '');
      const { stdout } = await execution;
      assert.doesNotMatch(stdout, /disposable_package_token|encryptionKey|encryptionIv/);
      return stdout;
    };
    await run(['login', '--server', serverUrl, '--token-stdin'], directory, { input: 'disposable_package_token\n' });
    const recovery = join(directory, 'recovery.secret.json');
    const status = JSON.parse(await run(['status', '--proof-out', recovery], project));
    assert.equal(status.proof.protocol, 'rivet-backup-proof-v2');
    assert.deepEqual(JSON.parse(await readFile(recovery, 'utf8')), proof);
    assert.equal(JSON.parse(await run(['backup', '--no-wait'], project)).accepted, true);
    await rm(project, { recursive: true }); await rm(bundle);
    const recoveryDirectory = join(directory, 'recovery'); await mkdir(recoveryDirectory);
    const result = JSON.parse(await run(['restore', 'Owner/project', '--bundle', encryptedFile, '--rpc', rpcUrl], recoveryDirectory));
    assert.equal(result.valid, true); assert.equal(result.bare, true); assert.deepEqual(result.refs, refs);
    assert.equal(await realpath(result.restored), await realpath(join(recoveryDirectory, 'project-restored.git')));
    await git(['fsck', '--full', '--strict'], result.restored);
    await run(['logout'], directory);
    const offline = JSON.parse(await run(['verify', '--proof', recovery, '--bundle', encryptedFile, '--rpc', rpcUrl], directory,
      { env: { ...env, RIVET_CONFIG_DIR: 'intentionally-invalid-unused-path' } }));
    assert.equal(offline.valid, true);
    const ownerKey = join(directory, 'owner.pem'), emails = join(directory, 'emails.json'), attributionTarget = join(directory, 'attribution');
    await run(['keygen', '--out', ownerKey], directory);
    await writeFile(emails, JSON.stringify([{ from: 'package@example.test', to: 'new@example.test' }]));
    const attribution = JSON.parse(await run(['restore', 'Owner/project', '--mode', 'attribution', '--proof', recovery, '--bundle', encryptedFile,
      '--rpc', rpcUrl, '--target', attributionTarget, '--email-map', emails, '--signing-key', ownerKey], directory));
    assert.equal(attribution.anchored, false);
    const mapping = JSON.parse(await readFile(attribution.mappingFile, 'utf8'));
    const lock = { codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: `0x${'22'.repeat(20)}` };
    mappingTransaction = ccc.Transaction.from({ outputs: [{ lock, capacity: ccc.fixedPointFrom(100) }], outputsData: [mappingAnchorData(mapping)] });
    const receipt = join(directory, 'mapping-anchor.json');
    await writeFile(receipt, JSON.stringify({ protocol: 'rivet-mapping-anchor-receipt-v1', network: 'ckb-testnet',
      mappingDigest: mappingDigest(mapping), txHash: mappingTransaction.hash(), outputIndex: 0, signedTransaction: mappingTransaction.toHex(), state: 'prepared' }));
    const anchored = JSON.parse(await run(['anchor-mapping', '--mapping', attribution.mappingFile, '--owner-key', `${ownerKey}.pub`,
      '--ckb-key-file', join(directory, 'missing-never-read'), '--receipt-out', receipt, '--rpc', rpcUrl], directory));
    assert.equal(anchored.state, 'confirmed');
    const verifiedMapping = JSON.parse(await run(['verify-mapping', '--mapping', attribution.mappingFile, '--owner-key', `${ownerKey}.pub`,
      '--proof', recovery, '--bundle', encryptedFile, '--target', attribution.restored, '--rpc', rpcUrl, '--anchor', anchored.txHash], directory));
    assert.equal(verifiedMapping.valid, true); assert.equal(verifiedMapping.mappingAnchor.txHash, mappingTransaction.hash());
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(directory, { recursive: true, force: true });
  }
});
