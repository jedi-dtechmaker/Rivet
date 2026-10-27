const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { createManifestStateStore, manifestAttemptDigest } = require('../src/lib/cota-manifest-state.ts');

const hex32 = () => `0x${randomBytes(32).toString('hex')}`;
const source = () => `${hex32()}:0`;
function tx(witness = '0x') {
  const transaction = ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: `0x${'ab'.repeat(32)}`, index: 0 } }],
    outputs: [{ capacity: ccc.fixedPointFrom(150), lock: { codeHash: `0x${'cd'.repeat(32)}`, hashType: 'type', args: '0x1234' } }],
    outputsData: ['0x'], witnesses: [witness],
  });
  return {
    transaction,
    json: JSON.parse(transaction.stringify()),
    bytes: ccc.hexFrom(transaction.toBytes()),
    hash: transaction.hash(),
  };
}

test('manifest attempt digests include witnesses excluded from the raw transaction hash', () => {
  const first = tx('0x1234');
  const second = tx('0x5678');
  assert.equal(first.hash, second.hash);
  assert.notEqual(manifestAttemptDigest(first.bytes), manifestAttemptDigest(second.bytes));
  assert.throws(() => manifestAttemptDigest('0x1'), /serialized/);
});

test('CoTA publication state transitions are atomic in PostgreSQL', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async t => {
  const { PrismaClient } = require('@prisma/client');
  const database = new PrismaClient({ datasources: { db: { url: process.env.RIVET_TEST_DATABASE_URL } } });
  const state = createManifestStateStore(database);
  const users = [];
  const streams = [];
  async function reservation(extra = {}) {
    const user = await database.user.create({ data: { githubId: `manifest-state-${randomUUID()}` } });
    users.push(user.id);
    const identity = { network: 'ckb-testnet', cotaScriptHash: hex32(), sourceOutpoint: source(), userId: user.id, kind: 'update', snapshot: { version: 1 }, ...extra };
    const result = await state.reserve(identity);
    streams.push(result.stream.id);
    return { ...result, identity };
  }
  const commit = (operationId, transaction = tx()) => state.commitPlan(operationId, {
    unsignedTransaction: transaction.json, serializedUnsignedTransaction: transaction.bytes, txHash: transaction.hash, plan: { schema: 'test' },
  });
  const candidate = (operationId, transaction) => state.recordSignedAttempt(operationId, {
    signedTransaction: transaction.json, serializedTransaction: transaction.bytes, txHash: transaction.hash,
  });
  try {
    await t.test('concurrent protocols and users reserve one operation for the actual cell', async () => {
      const first = await reservation();
      const identities = Array.from({ length: 8 }, (_, index) => ({ ...first.identity, protocol: `protocol-${index}` }));
      const results = await Promise.all(identities.map(value => state.reserve(value)));
      assert.ok(results.every(value => value.existing && value.operation.id === first.operation.id));
      assert.equal(await database.cotaManifestOperation.count({ where: { streamId: first.stream.id, status: 'building' } }), 1);
      const foreign = await state.reserve({ ...first.identity, userId: null, protocol: 'another-protocol' });
      assert.equal(foreign.operation.userId, first.identity.userId);
      assert.equal(foreign.operation.id, first.operation.id);
    });

    await t.test('first reservations racing on a new stream deduplicate', async () => {
      const identity = { network: 'ckb-testnet', cotaScriptHash: hex32(), sourceOutpoint: source(), kind: 'define', snapshot: {} };
      const results = await Promise.all(Array.from({ length: 8 }, () => state.reserve(identity)));
      streams.push(results[0].stream.id);
      assert.equal(new Set(results.map(value => value.operation.id)).size, 1);
      assert.equal(results.filter(value => !value.existing).length, 1);
    });

    await t.test('a locked cell never blocks an unrelated cell publication', async () => {
      const first = await reservation();
      let release;
      let locked;
      const lockReady = new Promise(resolve => { locked = resolve; });
      const hold = new Promise(resolve => { release = resolve; });
      const blocker = database.$transaction(async db => {
        await db.$queryRaw`SELECT "id" FROM "PublicationStream" WHERE "id" = ${first.stream.id} FOR UPDATE`;
        locked();
        await hold;
      });
      await lockReady;
      try {
        const independent = await Promise.race([
          reservation(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('unrelated stream was blocked')), 2000)),
        ]);
        assert.notEqual(independent.stream.id, first.stream.id);
      } finally { release(); await blocker; }
    });

    await t.test('expired unpublished builds fence old workers and immutable plans do not expire', async () => {
      const first = await reservation();
      await database.publicationStream.update({ where: { id: first.stream.id }, data: { reservedUntil: new Date(0) } });
      const replacement = await state.reserve(first.identity);
      assert.notEqual(replacement.operation.id, first.operation.id);
      assert.equal((await database.cotaManifestOperation.findUnique({ where: { id: first.operation.id } })).status, 'abandoned');
      await assert.rejects(commit(first.operation.id), /reservation changed/);
      const plan = await commit(replacement.operation.id);
      await database.publicationStream.update({ where: { id: first.stream.id }, data: { reservedUntil: new Date(0) } });
      const repeated = await state.reserve(first.identity);
      assert.equal(repeated.operation.id, plan.id);
      await assert.rejects(commit(plan.id, tx('0x1234')), /immutable/);
    });

    await t.test('snapshot compare-and-swap failure does not persist a stale plan', async () => {
      const first = await reservation();
      const unsigned = tx();
      await assert.rejects(state.commitPlan(first.operation.id, {
        unsignedTransaction: unsigned.json, serializedUnsignedTransaction: unsigned.bytes, txHash: unsigned.hash,
        assertSnapshot: async () => { throw new Error('wallet revision changed'); },
      }), /wallet revision changed/);
      const saved = await database.cotaManifestOperation.findUnique({ where: { id: first.operation.id } });
      assert.equal(saved.status, 'building');
      assert.equal(saved.unsignedTransaction, null);
      await commit(first.operation.id);
    });

    await t.test('verified external heads advance an idle stream but cannot replace pending work', async () => {
      const first = await reservation();
      await state.abandonBuild(first.operation.id);
      const successor = source();
      const moved = await state.reconcileHead({ ...first.identity, sourceOutpoint: successor });
      assert.equal(moved.headOutpoint, successor);
      assert.ok(moved.revision > first.stream.revision);
      const pending = await state.reserve({ ...first.identity, sourceOutpoint: successor });
      await assert.rejects(state.reconcileHead({ ...first.identity, sourceOutpoint: source() }), /explicit reconciliation/);
      const saved = await database.publicationStream.findUnique({ where: { id: first.stream.id } });
      assert.equal(saved.reservationId, pending.operation.id);
      assert.equal(saved.headOutpoint, successor);
    });

    await t.test('invalid signatures remain archived while a corrected candidate may pass', async () => {
      const first = await reservation();
      await commit(first.operation.id);
      const bad = await candidate(first.operation.id, tx('0xbad0'));
      await state.finishPreflight(bad.id, 'invalid', { code: 'invalid_signature' });
      const good = await candidate(first.operation.id, tx('0x600d'));
      assert.equal(bad.txHash, good.txHash);
      assert.notEqual(bad.digest, good.digest);
      await assert.rejects(state.acceptAttempt(first.operation.id, bad.id), /preflight/);
      await state.finishPreflight(good.id, 'passed');
      await state.acceptAttempt(first.operation.id, good.id);
      assert.equal((await database.cotaManifestSignedAttempt.findUnique({ where: { id: bad.id } })).preflight, 'invalid');
      await assert.rejects(state.finishPreflight(bad.id, 'passed'), /cannot be rewritten/);
      await assert.rejects(candidate(first.operation.id, tx('0x9999')), /cannot be replaced/);

      const send = await state.beginBroadcast(first.operation.id);
      const beforeNetworkSend = await database.cotaManifestSignedAttempt.findUnique({ where: { id: send.attempt.id } });
      assert.ok(beforeNetworkSend.firstBroadcastAt);
      assert.equal(beforeNetworkSend.serializedTransaction, tx('0x600d').bytes);
      await state.markBroadcast(send.attempt.id, 'unknown', { reason: 'timeout after send' });
      await database.publicationStream.update({ where: { id: first.stream.id }, data: { reservedUntil: new Date(0) } });
      const reserved = await state.reserve(first.identity);
      assert.equal(reserved.operation.id, first.operation.id);
      assert.equal(reserved.operation.status, 'unknown');
      const retry = await state.beginBroadcast(first.operation.id);
      assert.equal(retry.attempt.digest, send.attempt.digest);
      assert.equal(retry.attempt.serializedTransaction, send.attempt.serializedTransaction);
      assert.equal(retry.attempt.firstBroadcastAt.getTime(), send.attempt.firstBroadcastAt.getTime());
    });

    await t.test('unsupported operations remain blocked rather than requesting another signature', async () => {
      const first = await reservation();
      await commit(first.operation.id);
      const attempt = await candidate(first.operation.id, tx('0x1234'));
      await state.finishPreflight(attempt.id, 'unsupported', { code: 16 });
      await database.publicationStream.update({ where: { id: first.stream.id }, data: { reservedUntil: new Date(0) } });
      assert.equal((await state.reserve(first.identity)).operation.status, 'blocked');
      await assert.rejects(candidate(first.operation.id, tx('0x5678')), /cannot be replaced/);
      await assert.rejects(state.beginBroadcast(first.operation.id), /no accepted signature/);
    });

    await t.test('confirmed chain witnesses are retained and the confirmed successor frees the cell', async () => {
      const first = await reservation();
      await commit(first.operation.id);
      const attempt = await candidate(first.operation.id, tx('0x1234'));
      await state.finishPreflight(attempt.id, 'passed');
      await state.acceptAttempt(first.operation.id, attempt.id);
      await assert.rejects(state.confirm(first.operation.id, { transaction: tx('0x5678').json, successorOutpoint: `${attempt.txHash}:0` }), /not started broadcasting/);
      await state.beginBroadcast(first.operation.id);
      // Witness validation belongs to the protocol caller. Persistence must
      // retain the actual committed witness, rather than a local candidate.
      const actual = tx('0x5678');
      const successor = `${actual.hash}:0`;
      const confirmations = await Promise.all(Array.from({ length: 4 }, () => state.confirm(first.operation.id, { transaction: actual.json, successorOutpoint: successor })));
      assert.equal(new Set(confirmations.map(value => value.id)).size, 1);
      const confirmed = confirmations[0];
      assert.equal(confirmed.status, 'confirmed');
      assert.deepEqual(confirmed.confirmedTransaction, actual.json);
      const oldAttempt = await database.cotaManifestSignedAttempt.findUnique({ where: { id: attempt.id } });
      assert.deepEqual(oldAttempt.signedTransaction, tx('0x1234').json);
      const stream = await database.publicationStream.findUnique({ where: { id: first.stream.id } });
      assert.equal(stream.reservationId, null);
      assert.equal(stream.headOutpoint, successor);
      const next = await state.reserve({ ...first.identity, sourceOutpoint: successor });
      assert.notEqual(next.operation.id, confirmed.id);
      assert.ok(next.operation.revision > confirmed.revision);
    });

    await t.test('mismatched serialized candidates cannot be persisted', async () => {
      const first = await reservation();
      await commit(first.operation.id);
      const firstTx = tx('0x1234');
      await assert.rejects(state.recordSignedAttempt(first.operation.id, {
        signedTransaction: firstTx.json, serializedTransaction: tx('0x5678').bytes, txHash: firstTx.hash,
      }), /do not agree/);
      assert.equal(await database.cotaManifestSignedAttempt.count({ where: { operationId: first.operation.id } }), 0);
    });
  } finally {
    await database.cotaManifestSignedAttempt.deleteMany({ where: { operation: { streamId: { in: streams } } } });
    await database.cotaManifestOperation.deleteMany({ where: { streamId: { in: streams } } });
    await database.publicationStream.deleteMany({ where: { id: { in: streams } } });
    await database.user.deleteMany({ where: { id: { in: users } } });
    await database.$disconnect();
  }
});
