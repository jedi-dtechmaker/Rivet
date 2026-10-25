const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mock, test } = require('node:test');

test('CoTA record preparation and signed retries persist once under concurrent PostgreSQL requests', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.RIVET_TEST_DATABASE_URL;
  const { ccc } = require('@ckb-ccc/core');
  const { prisma } = require('../src/lib/db.ts');
  const { prepareRecords: prepare, submitRecords, publicUpdate } = require('../src/lib/cota-records.ts');
  const { WITNESS_PROTOCOL } = require('../src/lib/identity-proof.ts');
  const prepareRecords = (githubId, client) => prepare(githubId, client, WITNESS_PROTOCOL);
  const { EMPTY_ROOT } = require('../src/lib/cota-smt.ts');
  const { cotaTypeForLock } = require('../src/lib/cota.ts');
  const client = new ccc.ClientPublicTestnet();
  const owner = await ccc.Address.fromKnownScript(client, ccc.KnownScript.JoyId, `0x0001${randomUUID().replaceAll('-', '').padEnd(40, '0')}`);
  const user = await prisma.user.create({ data: {
    githubId: `cota-record-test-${randomUUID()}`, githubUsername: 'record-tester', ckbAddress: owner.toString(), ckbAddressVerifiedAt: new Date(),
  } });
  const initialHash = `0x${'ab'.repeat(32)}`;
  const backupHash = `0x${'cd'.repeat(32)}`;
  const cell = ccc.Cell.from({
    outPoint: { txHash: initialHash, index: 1 },
    cellOutput: { lock: owner.script, type: cotaTypeForLock(owner.script), capacity: ccc.fixedPointFrom(150) },
    outputData: `0x02${EMPTY_ROOT.slice(2)}`,
  });
  let committed = false;
  try {
    await prisma.cotaRegistration.create({ data: { userId: user.id, address: user.ckbAddress, txHash: initialHash, outputIndex: 1, status: 'confirmed' } });
    await prisma.repository.createMany({ data: [
      { userId: user.id, githubRepoId: `${user.githubId}/public`, fullName: `${user.githubId}/public`, name: 'public', isPrivate: false, isBackedUp: true, ckbTxHash: backupHash, ckbCellOutpoint: `${backupHash}:0`, lastBackupCid: 'public-cid' },
      { userId: user.id, githubRepoId: `${user.githubId}/private`, fullName: `${user.githubId}/private`, name: 'private', isPrivate: true, isBackedUp: true, ckbTxHash: backupHash, ckbCellOutpoint: `${backupHash}:0`, lastBackupCid: 'never-publish-this-cid' },
    ] });
    mock.method(client, 'findSingletonCellByType', async () => cell);
    mock.method(client, 'getTransaction', async hash => hash === initialHash ? { status: 'committed' }
      : hash === backupHash ? { status: 'committed', transaction: { outputsData: [`0x${'ef'.repeat(32)}`] } }
      : committed ? { status: 'committed', transaction: ccc.Transaction.from((await prisma.cotaUpdate.findFirst({ where: { userId: user.id } })).signedTransaction) } : undefined);
    mock.method(client, 'sendTransactionDry', async () => 1n);
    const [first, second] = await Promise.all([prepareRecords(user.githubId, client), prepareRecords(user.githubId, client)]);
    assert.equal(first.update.id, second.update.id);
    assert.equal(await prisma.cotaUpdate.count({ where: { userId: user.id } }), 1);
    assert.equal(first.update.records.length, 2);
    assert.doesNotMatch(JSON.stringify(first.update.records), /never-publish-this-cid/);
    assert.ok(Number(publicUpdate(first.update).feeCKB) < 0.01);
    const signed = ccc.Transaction.from(first.update.unsignedTransaction);
    signed.setWitnessArgs(0, { ...signed.getWitnessArgs(0), lock: '0x1234' });
    const broadcasts = [];
    mock.method(client, 'sendTransaction', async transaction => {
      const persisted = await prisma.cotaUpdate.findUnique({ where: { id: first.update.id } });
      assert.ok(persisted.signedTransaction);
      broadcasts.push(transaction.stringify());
      if (broadcasts.length === 1) throw new Error('Interrupted after persistence');
      return transaction.hash();
    });
    await assert.rejects(submitRecords(user.githubId, first.update.id, signed, client), /Interrupted/);
    assert.equal((await submitRecords(user.githubId, first.update.id, undefined, client)).status, 'submitted');
    assert.equal(broadcasts[0], broadcasts[1]);
    committed = true;
    assert.equal((await submitRecords(user.githubId, first.update.id, undefined, client)).status, 'confirmed');
    assert.equal(broadcasts.length, 2);
    assert.equal(await prisma.cotaRegistration.count({ where: { userId: user.id } }), 1);
    const saved = await prisma.cotaUpdate.findUnique({ where: { id: first.update.id } });
    cell.outPoint = ccc.OutPoint.from({ txHash: saved.txHash, index: 0 });
    const repeat = await prepareRecords(user.githubId, client);
    assert.equal(repeat.unchanged, true);
    assert.equal(repeat.update.id, saved.id);
    assert.equal(await prisma.cotaUpdate.count({ where: { userId: user.id } }), 1);
  } finally {
    mock.restoreAll();
    await prisma.cotaUpdate.deleteMany({ where: { userId: user.id } });
    await prisma.cotaRegistration.deleteMany({ where: { userId: user.id } });
    await prisma.repository.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
