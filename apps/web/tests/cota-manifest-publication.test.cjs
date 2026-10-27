const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { createManifestStateStore } = require('../src/lib/cota-manifest-state.ts');
const { ManifestPublicationError, manifestPreflightFailure, submitManifestOperation, refreshManifestOperation } = require('../src/lib/cota-manifest-publication.ts');

const hex32 = () => `0x${randomBytes(32).toString('hex')}`;
const JOYID = 'd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac';
function scriptFailure(kind, code, hash = JOYID) {
  return Object.assign(new Error('private signed transaction and private RPC URL'), { code: -302,
    data: `Verification(Error { source: Inputs[0].${kind}, cause: ValidationFailure: see error code ${code} on page https://nervosnetwork.github.io/ckb-script-error-codes/by-type-hash/${hash}.html#${code} })` });
}

test('manifest preflight classification keeps signatures, unsupported plans, and outages distinct', () => {
  assert.equal(manifestPreflightFailure(scriptFailure('Lock', -31)).outcome, 'invalid');
  assert.equal(manifestPreflightFailure(scriptFailure('Lock', 16)).outcome, 'unsupported');
  assert.equal(manifestPreflightFailure(scriptFailure('Type', 1)).outcome, 'unsupported');
  assert.equal(manifestPreflightFailure({ code: -302, data: 'private unrecognized response' }).outcome, 'unsupported');
  const outage = manifestPreflightFailure(new Error('private endpoint', { cause: Object.assign(new Error('private request'), { code: 'ETIMEDOUT' }) }));
  assert.equal(outage.outcome, 'unavailable');
  assert.equal(outage.diagnostics.causeCode, 'ETIMEDOUT');
  assert.doesNotMatch(JSON.stringify(outage), /private/);
  const typed = new ccc.ErrorClientVerification({ code: -302, data: 'private' }, 'lock', 0, 16, 'type', `0x${JOYID}`);
  assert.equal(manifestPreflightFailure(typed).outcome, 'unsupported');
});

test('CoTA publication validates, persists, broadcasts and reconciles safely', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async t => {
  const { PrismaClient } = require('@prisma/client');
  const database = new PrismaClient({ datasources: { db: { url: process.env.RIVET_TEST_DATABASE_URL } } });
  const state = createManifestStateStore(database);
  const streams = [];
  async function plan(kind = 'update') {
    const hash = hex32();
    const reserved = await state.reserve({ network: 'ckb-testnet', cotaScriptHash: hex32(),
      sourceOutpoint: `${hash}:0`, kind, snapshot: { test: true } });
    streams.push(reserved.stream.id);
    const lock = { codeHash: `0x${'cd'.repeat(32)}`, hashType: 'type', args: '0x1234' };
    const unsigned = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: hash, index: 0 }, cellOutput: { capacity: ccc.fixedPointFrom(150), lock }, outputData: '0x' }],
      outputs: [{ capacity: ccc.fixedPointFrom('149.9999'), lock }], outputsData: ['0x'],
    });
    unsigned.setWitnessArgs(0, { inputType: '0x1234', outputType: '0xabcd' });
    const operation = await state.commitPlan(reserved.operation.id, { unsignedTransaction: JSON.parse(unsigned.stringify()),
      serializedUnsignedTransaction: ccc.hexFrom(unsigned.toBytes()), txHash: unsigned.hash() });
    const signed = (value = '0x1111') => {
      const transaction = unsigned.clone();
      transaction.setWitnessArgs(0, { ...transaction.getWitnessArgs(0), lock: value });
      return transaction;
    };
    return { operation, unsigned, signed };
  }
  function mockClient(overrides = {}) {
    const sent = [];
    const client = {
      getTransaction: async () => undefined,
      sendTransactionDry: async () => 1n,
      sendTransaction: async transaction => { sent.push(ccc.hexFrom(transaction.toBytes())); return transaction.hash(); },
      ...overrides,
    };
    return { client, sent };
  }
  const validateSigned = (unsigned, signed) => {
    assert.equal(unsigned.hash(), signed.hash());
    assert.ok(signed.getWitnessArgs(0)?.lock && signed.getWitnessArgs(0).lock !== '0x');
  };
  const options = (client, extra = {}) => ({ database, client, validateSigned, ...extra });
  const failureIs = code => error => {
    assert.ok(error instanceof ManifestPublicationError);
    assert.equal(error.code, code);
    assert.doesNotMatch(JSON.stringify(error), /private/);
    return true;
  };
  const read = id => database.cotaManifestOperation.findUnique({ where: { id } });
  async function accept(operation, signed) {
    const attempt = await state.recordSignedAttempt(operation.id, { signedTransaction: JSON.parse(signed.stringify()),
      serializedTransaction: ccc.hexFrom(signed.toBytes()), txHash: signed.hash() });
    await state.finishPreflight(attempt.id, 'passed');
    await state.acceptAttempt(operation.id, attempt.id);
    return attempt;
  }
  try {
    await t.test('invalid signatures are archived and a corrected signature publishes the same plan', async () => {
      const prepared = await plan();
      let preflights = 0;
      const sent = [];
      const { client } = mockClient({
        sendTransactionDry: async () => { if (++preflights === 1) throw scriptFailure('Lock', -31); return 1n; },
        sendTransaction: async transaction => {
          const saved = await read(prepared.operation.id);
          const persisted = await database.cotaManifestSignedAttempt.findUnique({ where: { id: saved.acceptedAttemptId } });
          assert.equal(saved.status, 'broadcasting');
          assert.ok(persisted.firstBroadcastAt);
          assert.equal(persisted.serializedTransaction, ccc.hexFrom(transaction.toBytes()));
          sent.push(transaction.stringify());
          return transaction.hash();
        },
      });
      await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed('0xbad0') })), failureIs('MANIFEST_SIGNATURE_INVALID'));
      assert.equal((await read(prepared.operation.id)).status, 'awaiting_signature');
      const submitted = await submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed('0x600d') }));
      assert.equal(submitted.status, 'submitted');
      assert.equal(sent.length, 1);
      const attempts = await database.cotaManifestSignedAttempt.findMany({ where: { operationId: submitted.id }, orderBy: { createdAt: 'asc' } });
      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].preflight, 'invalid');
      assert.equal(attempts[1].preflight, 'passed');
      assert.notEqual(attempts[0].digest, attempts[1].digest);
      const actual = prepared.signed('0x9999');
      client.getTransaction = async () => ({ status: 'committed', transaction: actual });
      let verifiedActual = false;
      const confirmed = await refreshManifestOperation(submitted, options(client, { validateSigned: (unsigned, signed) => {
        validateSigned(unsigned, signed); verifiedActual = signed.getWitnessArgs(0).lock === '0x9999';
      } }));
      assert.equal(confirmed.status, 'confirmed');
      assert.ok(verifiedActual);
      assert.deepEqual(confirmed.confirmedTransaction, JSON.parse(actual.stringify()));
      assert.equal(attempts[1].signedTransaction.witnesses[0], prepared.signed('0x600d').witnesses[0]);
    });

    for (const [label, error] of [['CoTA type rejection', scriptFailure('Type', 7)], ['JoyID extension rejection', scriptFailure('Lock', 16)]]) {
      await t.test(`${label} blocks the plan and another signature cannot repair it`, async () => {
        const prepared = await plan();
        const { client, sent } = mockClient({ sendTransactionDry: async () => { throw error; } });
        await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() })), failureIs('MANIFEST_PLAN_UNSUPPORTED'));
        assert.equal((await read(prepared.operation.id)).status, 'blocked');
        await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed('0x2222') })), failureIs('MANIFEST_PLAN_UNSUPPORTED'));
        assert.equal(sent.length, 0);
        assert.equal(await database.cotaManifestSignedAttempt.count({ where: { operationId: prepared.operation.id } }), 1);
      });
    }

    await t.test('a transient preflight outage retries the saved candidate without another wallet signature', async () => {
      const prepared = await plan();
      let checks = 0;
      const { client, sent } = mockClient({ sendTransactionDry: async () => { if (++checks === 1) throw new Error('private endpoint timeout'); return 1n; } });
      await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() })), failureIs('MANIFEST_PREFLIGHT_UNAVAILABLE'));
      assert.equal((await read(prepared.operation.id)).status, 'awaiting_signature');
      const result = await submitManifestOperation(prepared.operation.id, options(client));
      assert.equal(result.status, 'submitted');
      assert.equal(checks, 2);
      assert.equal(sent.length, 1);
      assert.equal(await database.cotaManifestSignedAttempt.count({ where: { operationId: result.id } }), 1);
    });

    await t.test('an uncertain send ignores replacement signatures and retries the exact accepted bytes', async () => {
      const prepared = await plan();
      const sent = [];
      let checks = 0;
      const { client } = mockClient({
        sendTransactionDry: async () => { checks++; return 1n; },
        sendTransaction: async transaction => {
          sent.push(ccc.hexFrom(transaction.toBytes()));
          if (sent.length === 1) throw new Error('private response lost after broadcast');
          return transaction.hash();
        },
      });
      await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() })), failureIs('MANIFEST_SEND_UNCERTAIN'));
      assert.equal((await read(prepared.operation.id)).status, 'unknown');
      const result = await submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed('0x2222') }));
      assert.equal(result.status, 'submitted');
      assert.equal(checks, 1);
      assert.equal(sent.length, 2);
      assert.equal(sent[0], sent[1]);
      assert.equal(await database.cotaManifestSignedAttempt.count({ where: { operationId: result.id } }), 1);
    });

    await t.test('concurrent valid signatures choose one immutable accepted broadcast candidate', async () => {
      const prepared = await plan();
      const { client, sent } = mockClient();
      const results = await Promise.all(['0x1111', '0x2222', '0x3333', '0x4444'].map(lock =>
        submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed(lock) }))));
      assert.ok(results.every(value => value.id === prepared.operation.id && value.status === 'submitted'));
      const saved = await read(prepared.operation.id);
      const accepted = await database.cotaManifestSignedAttempt.findUnique({ where: { id: saved.acceptedAttemptId } });
      assert.ok(sent.length > 0);
      assert.ok(sent.every(bytes => bytes === accepted.serializedTransaction));
    });

    await t.test('a concurrent confirmation makes the original send completion idempotent', async () => {
      const prepared = await plan();
      const { client } = mockClient();
      client.sendTransaction = async signed => {
        client.getTransaction = async () => ({ status: 'committed', transaction: signed });
        const confirmed = await refreshManifestOperation(await read(prepared.operation.id), options(client));
        assert.equal(confirmed.status, 'confirmed');
        return signed.hash();
      };
      const result = await submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() }));
      assert.equal(result.status, 'confirmed');
      assert.deepEqual(result.confirmedTransaction, JSON.parse(prepared.signed().stringify()));
    });

    await t.test('committed proof witnesses are checked before any confirmation or export', async () => {
      const prepared = await plan();
      const { client } = mockClient();
      const submitted = await submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() }));
      const changed = prepared.signed();
      changed.setWitnessArgs(0, { ...changed.getWitnessArgs(0), outputType: '0xdead' });
      assert.equal(changed.hash(), prepared.unsigned.hash());
      client.getTransaction = async () => ({ status: 'committed', transaction: changed });
      await assert.rejects(refreshManifestOperation(submitted, options(client)), failureIs('MANIFEST_COMMITTED_BINDING_MISMATCH'));
      const blocked = await read(submitted.id);
      assert.equal(blocked.status, 'blocked');
      assert.equal(blocked.confirmedTransaction, null);
    });

    await t.test('an accepted plan already committed externally is verified without another broadcast', async () => {
      const prepared = await plan();
      const attempt = await accept(prepared.operation, prepared.signed());
      const actual = prepared.signed('0x2222');
      const { client, sent } = mockClient({ getTransaction: async () => ({ status: 'committed', transaction: actual }) });
      const result = await submitManifestOperation(prepared.operation.id, options(client));
      assert.equal(result.status, 'confirmed');
      assert.equal(sent.length, 0);
      assert.deepEqual(result.confirmedTransaction, JSON.parse(actual.stringify()));
      assert.equal((await database.cotaManifestSignedAttempt.findUnique({ where: { id: attempt.id } })).firstBroadcastAt, null);
    });

    await t.test('an accepted pending transaction prevents duplicate network sends', async () => {
      const prepared = await plan();
      await accept(prepared.operation, prepared.signed());
      const { client, sent } = mockClient({ getTransaction: async () => ({ status: 'pending', transaction: prepared.signed() }) });
      assert.equal((await submitManifestOperation(prepared.operation.id, options(client))).status, 'submitted');
      assert.equal(sent.length, 0);
    });

    await t.test('server signing is restricted to issuer operations', async () => {
      const prepared = await plan('claim');
      let signatures = 0;
      const { client, sent } = mockClient();
      await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, {
        signer: { signTransaction: async () => { signatures++; return prepared.signed(); } },
      })), failureIs('MANIFEST_OWNER_APPROVAL_REQUIRED'));
      assert.equal(signatures, 0);
      assert.equal(sent.length, 0);
    });

    await t.test('issuer signing publishes through the same persisted plan lifecycle', async () => {
      const prepared = await plan('issuer-define');
      let signatures = 0;
      const { client, sent } = mockClient();
      const result = await submitManifestOperation(prepared.operation.id, options(client, {
        signer: { signTransaction: async unsigned => { signatures++; validateSigned(unsigned, prepared.signed()); return prepared.signed(); } },
      }));
      assert.equal(result.status, 'submitted');
      assert.equal(signatures, 1);
      assert.equal(sent.length, 1);
    });

    await t.test('reconciliation outages preserve accepted bytes before any send', async () => {
      const prepared = await plan();
      let outage = true;
      const { client, sent } = mockClient({ getTransaction: async () => { if (outage) throw new Error('private RPC endpoint'); return undefined; } });
      await assert.rejects(submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() })), failureIs('MANIFEST_RECONCILIATION_UNAVAILABLE'));
      const saved = await read(prepared.operation.id);
      assert.equal(saved.status, 'signed_ready');
      assert.ok(saved.acceptedAttemptId);
      assert.equal(sent.length, 0);
      outage = false;
      assert.equal((await submitManifestOperation(prepared.operation.id, options(client))).status, 'submitted');
      assert.equal(sent.length, 1);
    });

    await t.test('a rejected node transaction retains its reservation for explicit reconciliation', async () => {
      const prepared = await plan();
      const { client, sent } = mockClient();
      const submitted = await submitManifestOperation(prepared.operation.id, options(client, { signedTransaction: prepared.signed() }));
      client.getTransaction = async () => ({ status: 'rejected', transaction: prepared.signed() });
      await assert.rejects(refreshManifestOperation(submitted, options(client)), failureIs('MANIFEST_RECONCILIATION_REQUIRED'));
      const blocked = await read(submitted.id);
      assert.equal(blocked.status, 'blocked');
      const stream = await database.publicationStream.findUnique({ where: { id: blocked.streamId } });
      assert.equal(stream.reservationId, blocked.id);
      assert.equal(sent.length, 1);
    });
  } finally {
    await database.cotaManifestSignedAttempt.deleteMany({ where: { operation: { streamId: { in: streams } } } });
    await database.cotaManifestOperation.deleteMany({ where: { streamId: { in: streams } } });
    await database.publicationStream.deleteMany({ where: { id: { in: streams } } });
    await database.$disconnect();
  }
});
