import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBackupAnchor, parseBackupAnchor, checkBackupAnchor, refsCommitment, sha256 } from '../src/anchor.mjs';

const anchor = { merkleRoot: `0x${'11'.repeat(32)}`, refsHash: `0x${'22'.repeat(32)}`,
  bundleSha256: `0x${'33'.repeat(32)}`, commitCount: 42, ipfsCid: `bafy${'a'.repeat(40)}` };

test('v2 wire format has a stable byte layout and legacy roots remain readable', () => {
  const data = encodeBackupAnchor(anchor);
  const expected = '52565402' + '11'.repeat(32) + '22'.repeat(32) + '33'.repeat(32)
    + '0000002a2c' + Buffer.from(anchor.ipfsCid).toString('hex');
  assert.equal(data, `0x${expected}`);
  assert.deepEqual(parseBackupAnchor(data), { version: 2, ...anchor });
  assert.deepEqual(parseBackupAnchor(anchor.merkleRoot), { version: 1, merkleRoot: anchor.merkleRoot });
  for (const changed of [{ ipfsCid: `bafy${'b'.repeat(40)}` }, { commitCount: 43 }, { merkleRoot: anchor.refsHash }]) {
    assert.throws(() => checkBackupAnchor(data, { ...anchor, ...changed }), /committed CKB anchor/);
  }
});

test('unknown versions, partial payloads, trailing data, invalid counts and malformed CIDs fail closed', () => {
  const data = encodeBackupAnchor(anchor);
  for (const altered of [data.replace('52565402', '52565403'), data.slice(0, -2), data + '00', '0x123', '0xgg',
    data.slice(0, 202) + '00000000' + data.slice(210), data.slice(0, -2) + 'ff']) {
    assert.throws(() => parseBackupAnchor(altered));
  }
  for (const changed of [{ commitCount: 0 }, { commitCount: 0x100000000 }, { ipfsCid: 'bafy-invalid' }, { refsHash: '0x12' }]) {
    assert.throws(() => encodeBackupAnchor({ ...anchor, ...changed }));
  }
});

test('refs hash is independent of enumeration order and binds branch names and annotated tag object IDs', () => {
  const main = `refs/heads/main ${'a'.repeat(40)}`, tag = `refs/tags/v1 ${'b'.repeat(40)}`;
  assert.equal(refsCommitment([tag, main]), sha256(`${main}\n${tag}\n`));
  assert.equal(refsCommitment([tag, main]), refsCommitment([main, tag]));
  assert.notEqual(refsCommitment([main, tag]), refsCommitment([main.replace('/main ', '/renamed '), tag]));
  assert.notEqual(refsCommitment([main, tag]), refsCommitment([main, tag.replace('b'.repeat(40), 'a'.repeat(40))]));
  assert.throws(() => refsCommitment([main, main]), /duplicate/);
});
