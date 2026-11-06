const assert = require('node:assert/strict');
const { test, afterEach, mock } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { prisma } = require('../src/lib/db.ts');
const { findPublicBackups, findPublicBackup, checkPublicBackupAnchor } = require('../src/lib/public-backups.ts');

afterEach(() => mock.restoreAll());

test('discovery and reference lookup exclude private profiles, private repositories and unfinished backups', async () => {
  const originalMany = prisma.repository.findMany;
  const originalFirst = prisma.repository.findFirst;
  const queries = [];
  try {
    prisma.repository.findMany = async query => { queries.push(query); return []; };
    prisma.repository.findFirst = async query => { queries.push(query); return null; };
    await findPublicBackups('developer', 2);
    await findPublicBackup('developer/repository');
    for (const query of queries) {
      assert.equal(query.where.isPrivate, false);
      assert.equal(query.where.isBackedUp, true);
      assert.equal(query.where.user.isProfilePublic, true);
      assert.equal(query.select.encryptionKey, undefined);
      assert.equal(query.select.encryptionIv, undefined);
      assert.equal(query.select.user, undefined);
    }
    assert.equal(queries[0].skip, 24);
    assert.equal(queries[0].take, 25);
    assert.ok(queries[1].where.OR.some(condition => condition.fullName?.equals === 'developer/repository'));
  } finally { prisma.repository.findMany = originalMany; prisma.repository.findFirst = originalFirst; }
});

test('empty proof references do not use database connections', async () => {
  const original = prisma.repository.findFirst;
  try {
    prisma.repository.findFirst = async () => { throw new Error('Unexpected query'); };
    assert.equal(await findPublicBackup('  '), null);
  } finally { prisma.repository.findFirst = original; }
});

const transaction = ccc.Transaction.from({
  outputs: [{ capacity: ccc.fixedPointFrom(100), lock: { codeHash: `0x${'12'.repeat(32)}`, hashType: 'type', args: '0x' } }],
  outputsData: [`0x${'34'.repeat(32)}`],
});
const backup = { ckbTxHash: transaction.hash(), ckbCellOutpoint: `${transaction.hash()}:0` };

test('anchor confirmation requires a committed matching transaction and the saved commitment output', async () => {
  const client = { getTransaction: async () => ({ status: 'committed', transaction, blockHash: 'block' }), getHeaderByHash: async () => ({ number: 123n }) };
  assert.deepEqual(await checkPublicBackupAnchor(backup, client), { status: 'confirmed', root: transaction.outputsData[0], blockHeight: '123' });
  assert.deepEqual(await checkPublicBackupAnchor({ ...backup, ckbCellOutpoint: `${transaction.hash()}:1` }, client), { status: 'invalid' });
  assert.deepEqual(await checkPublicBackupAnchor({ ...backup, ckbTxHash: `0x${'56'.repeat(32)}`, ckbCellOutpoint: `0x${'56'.repeat(32)}:0` }, client), { status: 'invalid' });
  assert.deepEqual(await checkPublicBackupAnchor({ ...backup, ckbCellOutpoint: `${transaction.hash()}:-1` }, client), { status: 'invalid' });
});

test('pending, rejected and unavailable chain data never produce a confirmed result', async () => {
  for (const status of ['pending', 'unknown']) assert.deepEqual(await checkPublicBackupAnchor(backup, { getTransaction: async () => ({ status }) }), { status: 'pending' });
  assert.deepEqual(await checkPublicBackupAnchor(backup, { getTransaction: async () => ({ status: 'rejected' }) }), { status: 'invalid' });
  assert.deepEqual(await checkPublicBackupAnchor(backup, { getTransaction: async () => { throw new Error('RPC outage'); } }), { status: 'unavailable' });
  const invalid = ccc.Transaction.from({ outputs: transaction.outputs, outputsData: ['0x1234'] });
  assert.deepEqual(await checkPublicBackupAnchor({ ckbTxHash: invalid.hash(), ckbCellOutpoint: `${invalid.hash()}:0` }, { getTransaction: async () => ({ status: 'committed', transaction: invalid }) }), { status: 'invalid' });
});
