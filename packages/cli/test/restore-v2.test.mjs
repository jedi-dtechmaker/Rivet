import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, randomBytes } from 'node:crypto';
import { commitRoot, git, verifyAnchor, verifyBundle, materializeBundle } from '../src/proof.mjs';
import { encodeBackupAnchor, refsCommitment, sha256 } from '../src/anchor.mjs';
import { main } from '../src/cli.mjs';

test('v2 CLI restore verifies chain, decrypted bytes, commits, branches and annotated tags after deleting the source', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'rivet-v2-'));
  try {
    const original = join(temp, 'source'), bundle = join(temp, 'source.bundle'), encryptedPath = join(temp, 'encrypted.bundle');
    await git(['init', '--initial-branch=main', original]);
    await git(['config', 'user.name', 'Recovery test'], original);
    await git(['config', 'user.email', 'recovery@example.test'], original);
    await writeFile(join(original, 'readme'), 'first\n');
    await git(['add', '.'], original); await git(['commit', '-m', 'first'], original);
    await git(['branch', 'feature'], original); await git(['tag', '-a', 'v1', '-m', 'annotated tag'], original);
    await writeFile(join(original, 'readme'), 'second\n'); await git(['commit', '-am', 'second'], original);
    await git(['bundle', 'create', bundle, '--all'], original);
    const commits = (await git(['log', '--all', '--format=%H'], original)).stdout.trim().split('\n');
    const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)'], original)).stdout.trim().split('\n');
    const bytes = await readFile(bundle);
    const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
    await writeFile(encryptedPath, encrypted);
    const txHash = `0x${'ab'.repeat(32)}`, blockHash = `0x${'cd'.repeat(32)}`;
    const proof = { protocol: 'rivet-backup-proof-v2', network: 'ckb-testnet', repository: 'owner/repo', txHash, outputIndex: 0,
      merkleRoot: commitRoot([...commits].sort()), refsHash: refsCommitment(refs), bundleSha256: sha256(bytes), commitCount: commits.length,
      ipfsCid: `bafy${'a'.repeat(40)}`, encryptionKey: key.toString('hex'), encryptionIv: iv.toString('hex') };
    const anchorData = encodeBackupAnchor(proof);
    mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(new URL(url).hostname, 'independent.example', 'No Rivet or GitHub requests during recovery');
      const { method } = JSON.parse(options.body);
      assert.ok(['get_transaction', 'get_header'].includes(method));
      return { ok: true, json: async () => ({ result: method === 'get_header' ? { number: '0x2a', hash: blockHash } : {
        tx_status: { status: 'committed', block_hash: blockHash }, transaction: { hash: txHash, outputs_data: [anchorData] },
      } }) };
    });
    const recovery = join(temp, 'recovery.json');
    await writeFile(recovery, JSON.stringify(proof), { mode: 0o600 });
    // Rename a branch while retaining every commit, then produce a different bundle.
    await git(['branch', '-m', 'feature', 'renamed'], original);
    const alteredBundle = join(temp, 'renamed.bundle');
    await git(['bundle', 'create', alteredBundle, '--all'], original);
    const alteredHash = sha256(await readFile(alteredBundle));
    await rm(original, { recursive: true }); await rm(bundle);
    const target = join(temp, 'restored.git');
    const output = mock.method(console, 'log', () => {});
    await main(['restore', 'owner/repo', '--mode', 'exact', '--proof', recovery, '--bundle', encryptedPath,
      '--rpc', 'https://independent.example', '--target', target]);
    const result = JSON.parse(output.mock.calls[0].arguments[0]);
    assert.equal(result.valid, true); assert.equal(result.anchorVersion, 2); assert.equal(result.blockHeight, '42');
    assert.deepEqual(result.refs, refs); assert.deepEqual(result.limitations, []);
    assert.equal(result.bundleSha256, proof.bundleSha256);
    assert.deepEqual((await git(['log', '--all', '--format=%H'], target)).stdout.trim().split('\n').sort(), [...commits].sort());
    await git(['fsck', '--full', '--strict'], target);
    await assert.rejects(verifyBundle(alteredBundle, proof), /anchored SHA-256/);
    await assert.rejects(verifyBundle(alteredBundle, { ...proof, bundleSha256: alteredHash }), /anchored refs hash/);
    // Recovery metadata cannot substitute a different bundle, CID, count or proof version.
    for (const change of [{ bundleSha256: alteredHash }, { refsHash: `0x${'ff'.repeat(32)}` },
      { ipfsCid: `bafy${'b'.repeat(40)}` }, { commitCount: 3 }, { protocol: 'rivet-backup-proof-v1' }]) {
      await assert.rejects(verifyAnchor({ ...proof, ...change }, 'https://independent.example'), /committed CKB anchor/);
    }
    const emptyTarget = join(temp, 'already-exists'); await mkdir(emptyTarget);
    await assert.rejects(materializeBundle(proof, { bundle: encryptedPath }, file => verifyBundle(file, proof, emptyTarget)), /EEXIST/);
    await access(emptyTarget);
    const failedTarget = join(temp, 'must-not-exist');
    await assert.rejects(materializeBundle(proof, { bundle: encryptedPath, maxBytes: 1 }, file => verifyBundle(file, proof, failedTarget)), /size limit/);
    await assert.rejects(access(failedTarget));
  } finally { mock.restoreAll(); await rm(temp, { recursive: true, force: true }); }
});
