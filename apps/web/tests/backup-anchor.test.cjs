const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { createBackupAnchorTransaction } = require('../scripts/backup-anchor.mjs');
const { encodeBackupAnchor } = require('../../../packages/cli/src/anchor.mjs');

const lock = ccc.Script.from({ codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: `0x${'22'.repeat(20)}` });
const previous = ccc.Cell.from({ outPoint: { txHash: `0x${'33'.repeat(32)}`, index: 0 },
  cellOutput: { lock, capacity: ccc.fixedPointFrom(93) }, outputData: `0x${'44'.repeat(32)}` });
const anchorData = encodeBackupAnchor({ merkleRoot: previous.outputData, refsHash: `0x${'55'.repeat(32)}`,
  bundleSha256: `0x${'66'.repeat(32)}`, commitCount: 2, ipfsCid: `bafy${'a'.repeat(40)}` });
const previousOutpoint = `${previous.outPoint.txHash}:0`;

test('new v2 anchor capacity includes the entire payload', async () => {
  const { transaction, reused } = await createBackupAnchorTransaction({ lock, anchorData, client: {} });
  assert.equal(reused, false); assert.equal(transaction.inputs.length, 0);
  const minimum = ccc.fixedPointFrom(61 + ccc.bytesFrom(anchorData).length);
  assert.equal(transaction.outputs[0].capacity, minimum);
  assert.equal(transaction.outputsData[0], anchorData);
});

test('legacy anchors are consumed and enlarged; later backups retain one successor and its capacity', async () => {
  const client = { getCellLive: async (outPoint, withData, includePool) => {
    assert.ok(outPoint.eq(previous.outPoint)); assert.equal(withData, true); assert.equal(includePool, true);
    return previous;
  } };
  const first = await createBackupAnchorTransaction({ client, lock, anchorData, previousOutpoint });
  assert.equal(first.reused, true); assert.equal(first.transaction.inputs.length, 1); assert.equal(first.transaction.outputs.length, 1);
  assert.ok(first.transaction.inputs[0].previousOutput.eq(previous.outPoint));
  assert.ok(first.transaction.outputs[0].capacity > previous.cellOutput.capacity);
  const successor = ccc.Cell.from({ outPoint: { txHash: first.transaction.hash(), index: 0 }, cellOutput: first.transaction.outputs[0], outputData: anchorData });
  client.getCellLive = async () => successor;
  const next = await createBackupAnchorTransaction({ client, lock, anchorData, previousOutpoint: `${successor.outPoint.txHash}:0` });
  assert.equal(next.transaction.outputs[0].capacity, successor.cellOutput.capacity);
  assert.ok(next.transaction.inputs[0].previousOutput.eq(successor.outPoint));
});

test('malformed, spent, foreign and uncertain predecessor cells cannot silently create a second anchor chain', async () => {
  for (const value of ['bad', `${previousOutpoint}:extra`, `${previous.outPoint.txHash}:4294967296`]) {
    await assert.rejects(createBackupAnchorTransaction({ client: {}, lock, anchorData, previousOutpoint: value }), /Invalid previous/);
  }
  for (const response of [undefined, ccc.Cell.from({ ...previous, cellOutput: { ...previous.cellOutput, lock: { ...lock, args: '0x' } } }),
    ccc.Cell.from({ ...previous, cellOutput: { ...previous.cellOutput, type: lock } }), ccc.Cell.from({ ...previous, outputData: '0x1234' })]) {
    await assert.rejects(createBackupAnchorTransaction({ client: { getCellLive: async () => response }, lock, anchorData, previousOutpoint }));
  }
  let calls = 0;
  await assert.rejects(createBackupAnchorTransaction({ client: { getCellLive: async () => { calls++; throw new Error('RPC timeout'); } }, lock, anchorData, previousOutpoint }), /RPC timeout/);
  assert.equal(calls, 1);
});
