import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, randomBytes } from 'node:crypto';
import { commitRoot, git, decryptBundle, verifyBundle, verifyAnchor, materializeBundle } from '../src/proof.mjs';
const txHash = `0x${'ab'.repeat(32)}`;
const proofFor = commits => ({ protocol: 'rivet-backup-proof-v1', network: 'ckb-testnet', repository: 'owner/repo',
  txHash, outputIndex: 0, ipfsCid: `bafy${'a'.repeat(40)}`, merkleRoot: commitRoot(commits), commitCount: commits.length });
test('exact restore verifies an encrypted bundle without the original repository and preserves branches and tags', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'rivet-cli-test-'));
  try {
    const original = join(temp, 'original'), bundle = join(temp, 'source.bundle'), target = join(temp, 'restored.git');
    await git(['init', '--initial-branch=main', original]);
    await git(['config', 'user.name', 'Developer'], original);
    await git(['config', 'user.email', 'dev@example.test'], original);
    await writeFile(join(original, 'readme'), 'one\n');
    await git(['add', '.'], original); await git(['commit', '-m', 'one'], original);
    await git(['branch', 'feature'], original); await git(['tag', 'v1'], original);
    await writeFile(join(original, 'readme'), 'two\n');
    await git(['commit', '-am', 'two'], original);
    await git(['bundle', 'create', bundle, '--all'], original);
    const { stdout } = await git(['log', '--all', '--format=%H'], original);
    const proof = proofFor(stdout.trim().split('\n'));
    const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(await readFile(bundle)), cipher.final(), cipher.getAuthTag()]);
    proof.encryptionKey = key.toString('hex'); proof.encryptionIv = iv.toString('hex');
    const encryptedPath = join(temp, 'encrypted'); await writeFile(encryptedPath, encrypted);
    await rm(original, { recursive: true }); await rm(bundle);
    const result = await materializeBundle(proof, { bundle: encryptedPath }, file => verifyBundle(file, proof, target));
    assert.equal(result.commitCount, 2); assert.equal(result.refs.length, 3);
    const restored = await git(['log', '--all', '--format=%H'], target);
    assert.equal(restored.stdout, stdout);
    await assert.rejects(materializeBundle({ ...proof, merkleRoot: `0x${'00'.repeat(32)}` }, { bundle: encryptedPath }, file => verifyBundle(file, { ...proof, merkleRoot: `0x${'00'.repeat(32)}` })));
    await assert.rejects(materializeBundle(proof, { bundle: encryptedPath }, file => verifyBundle(file, proof, target)));
    const altered = Buffer.from(encrypted); altered[0] ^= 1;
    assert.throws(() => decryptBundle(altered, proof));
    assert.throws(() => decryptBundle(encrypted, { ...proof, encryptionKey: '00'.repeat(32) }));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('verification rejects pending, mismatched and missing on-chain roots', async () => {
  const proof = proofFor(['1'.repeat(40)]);
  const request = (status, root) => async (_url, options) => {
    const method = JSON.parse(options.body).method;
    return { ok: true, json: async () => ({ result: method === 'get_header' ? { number: '0x2a' } : {
      tx_status: { status, block_hash: txHash }, transaction: { hash: txHash, outputs_data: [root] },
    } }) };
  };
  assert.equal((await verifyAnchor(proof, 'https://rpc.example', request('committed', proof.merkleRoot))).blockHeight, '42');
  for (const [status, root] of [['pending', proof.merkleRoot], ['committed', '0x'], ['committed', undefined]]) {
    await assert.rejects(verifyAnchor(proof, 'https://rpc.example', request(status, root)));
  }
});
