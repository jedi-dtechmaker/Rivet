const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { ccc } = require('@ckb-ccc/core');
const { prisma } = require('../src/lib/db.ts');
const { prepareRecords: prepare, submitRecords, publicUpdate, refreshCotaUpdate } = require('../src/lib/cota-records.ts');
const { WITNESS_PROTOCOL, LEGACY_PROTOCOL } = require('../src/lib/identity-proof.ts');
const prepareRecords = (githubId, client) => prepare(githubId, client, WITNESS_PROTOCOL);
const { EMPTY_ROOT, buildSmt } = require('../src/lib/cota-smt.ts');
const { cotaTypeForLock } = require('../src/lib/cota.ts');
const recordsRoute = require('../src/app/api/user/cota/records/route.ts');
const restorations = [];

afterEach(() => {
  mock.restoreAll();
  while (restorations.length) restorations.pop()();
});

function model(model, method, implementation) {
  const original = model[method];
  model[method] = mock.fn(implementation);
  restorations.push(() => { model[method] = original; });
}

async function fixture() {
  const client = new ccc.ClientPublicTestnet();
  const owner = await ccc.Address.fromKnownScript(client, ccc.KnownScript.JoyId, `0x0001${'12'.repeat(20)}`);
  const user = { id: 'user-db-id', githubId: '123', githubUsername: 'developer', ckbAddress: owner.toString(), ckbAddressVerifiedAt: new Date() };
  const cell = ccc.Cell.from({
    outPoint: { txHash: `0x${'34'.repeat(32)}`, index: 1 },
    cellOutput: { lock: owner.script, type: cotaTypeForLock(owner.script), capacity: ccc.fixedPointFrom(150) },
    outputData: `0x02${EMPTY_ROOT.slice(2)}`,
  });
  const anchorHash = `0x${'56'.repeat(32)}`;
  const merkleRoot = `0x${'78'.repeat(32)}`;
  let saved = null;
  let committed = false;
  const database = {
    $queryRaw: async () => [],
    user: { findUnique: async () => user },
    cotaRegistration: { findUnique: async () => ({ status: 'confirmed' }) },
    repository: { findMany: async ({ where }) => {
      assert.deepEqual(where, { userId: user.id, isBackedUp: true, isPrivate: false });
      return [{ fullName: 'developer/testing', ckbTxHash: anchorHash, lastBackupCid: 'public-backup-cid', ckbCellOutpoint: `${anchorHash}:0`, commitCount: 7 }];
    } },
    cotaUpdate: {
      findFirst: async ({ where }) => saved && saved.protocol === where.protocol && (where.status?.in?.includes(saved.status) || where.status === saved.status) ? saved : null,
      findUnique: async () => saved,
      create: async ({ data }) => { saved = { ...data, id: 'update-id' }; return saved; },
    },
  };
  mock.method(prisma, '$transaction', async callback => callback(database));
  model(prisma.user, 'findUnique', async () => user);
  model(prisma.cotaUpdate, 'findFirst', async ({ where }) => saved && saved.userId === where.userId && saved.id === where.id ? saved : null);
  model(prisma.cotaUpdate, 'findUnique', async () => saved);
  model(prisma.cotaUpdate, 'update', async ({ data }) => { saved = { ...saved, ...data }; return saved; });
  model(prisma.cotaUpdate, 'updateMany', async ({ data }) => { saved = { ...saved, ...data }; return { count: 1 }; });
  mock.method(client, 'findSingletonCellByType', async () => cell);
  mock.method(client, 'getTransaction', async hash => saved && hash === saved.txHash && committed ? { status: 'committed', transaction: ccc.Transaction.from(saved.signedTransaction) }
    : hash === cell.outPoint.txHash ? { status: 'committed' }
    : hash === anchorHash ? { status: 'committed', transaction: { outputsData: [merkleRoot] } }
    : undefined);
  mock.method(client, 'sendTransactionDry', async () => 1n);
  return { client, cell, user, database, merkleRoot, get saved() { return saved; }, setSaved(update) { saved = update; }, confirm() { committed = true; } };
}

test('identity record routes require GitHub authentication and reject foreign origins', async () => {
  mock.method(nextAuth, 'getServerSession', async () => null);
  assert.equal((await recordsRoute.GET()).status, 401);
  assert.equal((await recordsRoute.POST(new NextRequest('http://localhost:3000/api/user/cota/records', { method: 'POST' }))).status, 401);
  mock.restoreAll();
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: '123' } }));
  assert.equal((await recordsRoute.POST(new NextRequest('http://localhost:3000/api/user/cota/records', { method: 'POST', headers: { Origin: 'https://foreign.example' } }))).status, 403);
});

test('preparing records verifies public backup anchors and reuses the saved transaction across reconnects', async () => {
  const state = await fixture();
  const first = await prepareRecords(state.user.githubId, state.client);
  assert.equal(first.update.status, 'prepared');
  assert.equal(first.update.records.length, 2);
  assert.equal(first.update.records[0].record.kind === 'backup' || first.update.records[1].record.kind === 'backup', true);
  const backup = first.update.records.find(entry => entry.record.kind === 'backup');
  assert.equal(backup.record.merkleRoot, state.merkleRoot);
  assert.equal(backup.record.ipfsCid, 'public-backup-cid');
  assert.equal(buildSmt(first.update.leaves).root, first.update.root);
  const transaction = ccc.Transaction.from(first.update.unsignedTransaction);
  assert.equal(transaction.inputs.length, 1);
  assert.ok(transaction.outputs[0].capacity < ccc.fixedPointFrom(150));
  assert.ok(transaction.outputs[0].capacity > ccc.fixedPointFrom('149.99'));
  assert.equal(transaction.inputs[0].cellOutput.capacity, ccc.fixedPointFrom(150));
  assert.equal(transaction.outputsData[0], state.cell.outputData);
  assert.equal(transaction.getWitnessArgs(0).inputType, undefined);
  const proof = JSON.parse(Buffer.from(transaction.getWitnessArgs(0).outputType.slice(2), 'hex'));
  assert.equal(proof.protocol, WITNESS_PROTOCOL);
  assert.equal(proof.commitmentRoot, first.update.root);
  assert.equal(proof.ownerLockHash, state.cell.cellOutput.lock.hash());
  assert.equal(proof.previousProofTxHash, null);
  assert.equal(state.cell.cellOutput.capacity, ccc.fixedPointFrom(150));
  const second = await prepareRecords(state.user.githubId, state.client);
  assert.equal(second.update.id, first.update.id);
  assert.equal(second.update.txHash, first.update.txHash);
});

test('signed updates survive interrupted broadcasts and confirmation prevents another send', async () => {
  const state = await fixture();
  const first = await prepareRecords(state.user.githubId, state.client);
  const signed = ccc.Transaction.from(first.update.unsignedTransaction);
  signed.setWitnessArgs(0, { ...signed.getWitnessArgs(0), lock: '0x1234' });
  const sends = [];
  mock.method(state.client, 'sendTransaction', async transaction => {
    assert.ok(state.saved.signedTransaction);
    sends.push(transaction.stringify());
    if (sends.length === 1) throw new Error('Interrupted broadcast');
    return transaction.hash();
  });
  await assert.rejects(submitRecords(state.user.githubId, first.update.id, signed, state.client), /Interrupted/);
  assert.equal(state.saved.status, 'prepared');
  const retry = await submitRecords(state.user.githubId, first.update.id, undefined, state.client);
  assert.equal(retry.status, 'submitted');
  assert.equal(sends[0], sends[1]);
  state.confirm();
  const confirmed = await submitRecords(state.user.githubId, first.update.id, undefined, state.client);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(sends.length, 2);
});

test('continuing a prepared proof retries a transient read without starting another database transaction', async () => {
  const state = await fixture();
  const first = await prepareRecords(state.user.githubId, state.client);
  const startTransaction = mock.method(prisma, '$transaction', async () => { throw new Error('No transaction should start'); });
  let attempts = 0;
  model(prisma.cotaUpdate, 'findFirst', async ({ where }) => {
    assert.equal(where.user.githubId, state.user.githubId);
    assert.deepEqual(where.user.ckbAddressVerifiedAt, { not: null });
    assert.deepEqual(where.user.cotaRegistration, { is: { status: 'confirmed' } });
    assert.equal(where.protocol, WITNESS_PROTOCOL);
    if (++attempts === 1) throw Object.assign(new Error('database offline'), { code: 'P1001' });
    return state.saved;
  });
  const continued = await prepareRecords(state.user.githubId, state.client);
  assert.equal(continued.update.id, first.update.id);
  assert.equal(attempts, 2);
  assert.equal(startTransaction.mock.callCount(), 0);
});

test('existing wallet SMT data is preserved while proofs are anchored separately', async () => {
  const state = await fixture();
  state.cell.outputData = `0x02${'ab'.repeat(32)}`;
  const prepared = await prepareRecords(state.user.githubId, state.client);
  const transaction = ccc.Transaction.from(prepared.update.unsignedTransaction);
  assert.equal(transaction.outputsData[0], state.cell.outputData);
  assert.equal(publicUpdate(prepared.update).cotaRoot, `0x${'ab'.repeat(32)}`);
});

test('legacy preparation and submission are blocked without rebroadcasting or deleting the signature', async () => {
  const state = await fixture();
  const prepared = await prepareRecords(state.user.githubId, state.client);
  const old = { ...prepared.update, protocol: LEGACY_PROTOCOL, signedTransaction: { preserved: 'signed-attempt' } };
  state.setSaved(old);
  const send = mock.method(state.client, 'sendTransaction', async () => { throw new Error('must not broadcast'); });
  await assert.rejects(prepare(state.user.githubId, state.client), /incompatible with JoyID/);
  await assert.rejects(submitRecords(state.user.githubId, old.id, undefined, state.client), /incompatible with JoyID/);
  const result = publicUpdate(old);
  assert.equal(result.status, 'blocked');
  assert.equal(result.transaction, null);
  assert.deepEqual(state.saved.signedTransaction, { preserved: 'signed-attempt' });
  assert.equal(send.mock.callCount(), 0);
  state.database.cotaUpdate.findUnique = async ({ where }) => where.userId_sourceOutpoint_protocol.protocol === WITNESS_PROTOCOL ? null : old;
  const replacement = await prepareRecords(state.user.githubId, state.client);
  assert.equal(replacement.update.protocol, WITNESS_PROTOCOL);
  assert.deepEqual(old.signedTransaction, { preserved: 'signed-attempt' });
});

test('a node preflight rejection preserves the signed proof and prevents broadcasting', async () => {
  const state = await fixture();
  const prepared = await prepareRecords(state.user.githubId, state.client);
  const signed = ccc.Transaction.from(prepared.update.unsignedTransaction);
  signed.setWitnessArgs(0, { ...signed.getWitnessArgs(0), lock: '0x1234' });
  mock.method(state.client, 'sendTransactionDry', async () => { throw Object.assign(new Error('validation failure'), { code: -302 }); });
  const send = mock.method(state.client, 'sendTransaction', async () => signed.hash());
  await assert.rejects(submitRecords(state.user.githubId, prepared.update.id, signed, state.client), /validation failure/);
  assert.ok(state.saved.signedTransaction);
  assert.equal(state.saved.status, 'prepared');
  assert.equal(send.mock.callCount(), 0);
});

test('confirmation checks the actual on-chain proof witness, then unchanged sync avoids another fee', async () => {
  const state = await fixture();
  const prepared = await prepareRecords(state.user.githubId, state.client);
  const signed = ccc.Transaction.from(prepared.update.unsignedTransaction);
  signed.setWitnessArgs(0, { ...signed.getWitnessArgs(0), lock: '0x1234' });
  mock.method(state.client, 'sendTransaction', async () => signed.hash());
  await submitRecords(state.user.githubId, prepared.update.id, signed, state.client);
  const tampered = signed.clone();
  tampered.setWitnessArgs(0, { ...tampered.getWitnessArgs(0), outputType: '0x1234' });
  const get = mock.method(state.client, 'getTransaction', async () => ({ status: 'committed', transaction: tampered }));
  await assert.rejects(refreshCotaUpdate(state.saved, state.client), /differs/);
  get.mock.restore();
  state.confirm();
  const confirmed = await refreshCotaUpdate(state.saved, state.client);
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(publicUpdate(confirmed).proofTransaction, state.saved.signedTransaction);
  state.cell.outPoint = ccc.OutPoint.from({ txHash: confirmed.txHash, index: 0 });
  const repeat = await prepareRecords(state.user.githubId, state.client);
  assert.equal(repeat.unchanged, true);
  assert.equal(repeat.update.id, confirmed.id);
});

test('an unconfirmed backup is not included in an identity commitment', async () => {
  const state = await fixture();
  mock.method(state.client, 'getTransaction', async hash => hash === state.cell.outPoint.txHash ? { status: 'committed' } : { status: 'pending' });
  await assert.rejects(prepareRecords(state.user.githubId, state.client), /backup anchor is not confirmed/);
  assert.equal(state.saved, null);
});
