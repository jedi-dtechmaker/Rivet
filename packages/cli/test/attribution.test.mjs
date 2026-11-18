import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { git, commitRoot } from '../src/proof.mjs';
import { sha256, refsCommitment, encodeBackupAnchor } from '../src/anchor.mjs';
import { main } from '../src/cli.mjs';
import { canonical, generateOwnerKey, restoreAttribution, verifyAttribution, verifyMappingSignature, verifyMappingAnchor, mappingAnchorData } from '../src/attribution.mjs';

test('attribution recovers deleted source, preserves exact history and independently verifies every rewritten commit and tag', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'rivet-attribution-test-'));
  try {
    const source = join(temp, 'source'), bundle = join(temp, 'source.bundle'), target = join(temp, 'restored');
    await git(['init', '--initial-branch=main', source]);
    await git(['config', 'user.name', 'Original Author'], source);
    await git(['config', 'user.email', 'old@example.test'], source);
    await writeFile(join(source, 'readme'), 'initial\n');
    await git(['add', '.'], source); await git(['commit', '-m', 'initial'], source);
    await git(['branch', 'feature'], source);
    await git(['commit', '--allow-empty', '-m', 'keep empty commit'], source);
    await git(['checkout', 'feature'], source);
    await writeFile(join(source, 'feature'), 'feature\n'); await git(['add', '.'], source); await git(['commit', '-m', 'feature'], source);
    await git(['checkout', 'main'], source); await git(['merge', '--no-ff', 'feature', '-m', 'merge'], source);
    await git(['tag', '-a', 'v1', '-m', 'annotated'], source);
    await git(['bundle', 'create', bundle, '--all'], source);
    const commits = (await git(['rev-list', '--all'], source)).stdout.trim().split('\n').sort();
    const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)'], source)).stdout.trim().split('\n');
    const proof = { protocol: 'rivet-backup-proof-v2', network: 'ckb-testnet', repository: 'owner/project',
      txHash: `0x${'11'.repeat(32)}`, outputIndex: 0, ipfsCid: `bafy${'a'.repeat(40)}`, commitCount: commits.length,
      merkleRoot: commitRoot(commits), refsHash: refsCommitment(refs), bundleSha256: sha256(await readFile(bundle)) };
    const keyFile = join(temp, 'owner.pem'); await generateOwnerKey(keyFile);
    const privateKey = await readFile(keyFile, 'utf8'), publicKey = await readFile(`${keyFile}.pub`, 'utf8');
    await rm(source, { recursive: true });
    const recovery = join(temp, 'proof.json'), mappings = join(temp, 'emails.json');
    await writeFile(recovery, JSON.stringify(proof));
    await writeFile(mappings, JSON.stringify([{ from: 'old@example.test', to: 'new@example.test' }]));
    let result;
    await main(['restore', 'owner/project', '--mode', 'attribution', '--proof', recovery, '--bundle', bundle,
      '--email-map', mappings, '--signing-key', keyFile, '--target', target, '--rpc', 'https://rpc.fixture'], {
      cwd: temp, env: {}, log: text => { result = JSON.parse(text); },
      request: async (_url, init) => Response.json({ result: JSON.parse(init.body).method === 'get_header'
        ? { hash: `0x${'aa'.repeat(32)}`, number: '0x2a' } : { transaction: { hash: proof.txHash, outputs_data: [encodeBackupAnchor(proof)] },
          tx_status: { status: 'committed', block_hash: `0x${'aa'.repeat(32)}` } } }),
    });
    assert.equal(result.anchored, false);
    const document = JSON.parse(await readFile(result.mappingFile, 'utf8'));
    assert.equal(document.payload.commits.length, commits.length);
    assert.ok(document.payload.commits.every(row => row.old !== row.new));
    assert.deepEqual((await git(['rev-list', '--all'], result.original)).stdout.trim().split('\n').sort(), commits);
    assert.equal((await git(['log', '--all', '--format=%ae'], result.restored)).stdout.trim().split('\n').every(email => email === 'new@example.test'), true);
    assert.match((await git(['cat-file', '-p', 'refs/tags/v1'], result.restored)).stdout, /new@example.test/);
    assert.equal((await verifyAttribution(document, publicKey, result.original, result.restored, proof)).valid, true);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' });
    assert.throws(() => verifyMappingSignature(document, other), /trusted owner key/);
    const changed = structuredClone(document); changed.payload.commits.pop();
    assert.throws(() => verifyMappingSignature(changed, publicKey), /signature/);
    // Even a valid owner signature cannot make an incomplete mapping verify.
    changed.signature = sign(null, Buffer.from(canonical(changed.payload)), createPrivateKey(privateKey)).toString('base64');
    await assert.rejects(verifyAttribution(changed, publicKey, result.original, result.restored, proof), /does not reproduce/);
    await git(['update-ref', '-d', 'refs/heads/feature'], result.restored);
    await assert.rejects(verifyAttribution(document, publicKey, result.original, result.restored, proof), /differs/);
    await assert.rejects(restoreAttribution(bundle, proof, target, [{ from: 'old@example.test', to: 'new@example.test' }], privateKey), { code: 'EEXIST' });
    await assert.rejects(restoreAttribution(bundle, { ...proof, protocol: 'rivet-backup-proof-v1' }, join(temp, 'legacy'), [], privateKey), /v2 backup/);
    const txHash = `0x${'22'.repeat(32)}`, blockHash = `0x${'33'.repeat(32)}`;
    const request = async (_url, init) => Response.json({ result: JSON.parse(init.body).method === 'get_header'
      ? { hash: blockHash, number: '0x2a' } : { transaction: { hash: txHash, outputs_data: [mappingAnchorData(document)] }, tx_status: { status: 'committed', block_hash: blockHash } } });
    assert.equal((await verifyMappingAnchor(document, txHash, 0, 'https://rpc.fixture', request)).blockHeight, '42');
    await assert.rejects(verifyMappingAnchor(changed, txHash, 0, 'https://rpc.fixture', request), /differs/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
