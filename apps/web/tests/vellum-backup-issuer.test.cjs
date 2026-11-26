const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { argsToDid } = require('@ckb-ccc/did-ckb');
const { prisma } = require('../src/lib/db.ts');
const { acquireVellumIssuerLease, createVellumIssuerSigner, persistedVellumClaimTransaction,
  prepareVellumBackupClaim, reconcilePreparedVellumBackupClaim } = require('../src/lib/vellum-backup-claims.ts');
const { RIVET_BACKUP_SCHEMA_HASH, vellumClaimScripts } = require('../src/lib/vellum-config.ts');

const replacements = [];
function replace(target, key, implementation) {
  replacements.push([target, key, target[key]]);
  target[key] = mock.fn(implementation);
}
afterEach(() => {
  for (const [target, key, original] of replacements.splice(0).reverse()) target[key] = original;
  mock.restoreAll();
});

const SUBJECT_DID = argsToDid(`0x${'11'.repeat(20)}`);
const ISSUER_DID = argsToDid(`0x${'22'.repeat(20)}`);
const CONFIGURATION = { enabled: true, issuerDid: ISSUER_DID, issuerPrivateKey: `0x${'33'.repeat(32)}`, minimumConfirmations: 6 };
const PAYLOAD = { github_user_id: '1', github_repository_id: '2', repository: 'owner/project',
  snapshot_tx_hash: `0x${'44'.repeat(32)}`, snapshot_output_index: 0, anchor_version: 2, commit_count: 10, backed_up_at: 2_000_000_000 };
const LOCK = ccc.Script.from({ codeHash: `0x${'77'.repeat(32)}`, hashType: 'type', args: `0x${'88'.repeat(20)}` });

function persistedClaim(transaction) {
  return {
    repositoryId: 'repository-id', userId: 'user-id', subjectDid: SUBJECT_DID, issuerDid: ISSUER_DID,
    schemaHash: RIVET_BACKUP_SCHEMA_HASH, nonce: `0x${'55'.repeat(32)}`, payload: PAYLOAD,
    issuedAt: new Date(2_000_000_000_000), status: 'prepared', leaseToken: 'lease-token',
    claimId: `0x${'66'.repeat(32)}`, outputIndex: 0, signedTransaction: transaction.toHex(),
    transactionHash: transaction.hash(), confirmedAt: null, lastErrorCode: null, revision: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

test('claim preparation pins subject, issuer, schema, payload, timestamp and nonce before signing exact bytes', async () => {
  const transaction = ccc.Transaction.default();
  const signer = { signOnlyTransaction: async candidate => candidate };
  let written;
  const result = await prepareVellumBackupClaim({ subjectDid: SUBJECT_DID, payload: PAYLOAD,
    issuedAt: new Date(2_000_000_000_000), nonce: `0x${'55'.repeat(32)}` }, {}, CONFIGURATION, {
    createSigner: async () => signer,
    writeClaim: async input => { written = input; return { tx: transaction, claimId: `0x${'66'.repeat(32)}`, outputIndex: 2,
      issuerSource: { kind: 'input', inputIndex: 0, outputIndex: 0 }, controllerInputIndex: 0 }; },
  });
  assert.deepEqual(result, { claimId: `0x${'66'.repeat(32)}`, outputIndex: 2,
    signedTransaction: ccc.hexFrom(transaction.toBytes()), transactionHash: transaction.hash() });
  assert.deepEqual(written, { issuerSigner: signer, scripts: vellumClaimScripts, input: { subject: { did: SUBJECT_DID },
    issuerDid: ISSUER_DID, schemaHash: RIVET_BACKUP_SCHEMA_HASH, payload: PAYLOAD, issuedAt: 2_000_000_000, nonce: `0x${'55'.repeat(32)}` } });
});

test('claim preparation rejects any signer that changes the prepared transaction hash', async () => {
  const transaction = ccc.Transaction.default();
  await assert.rejects(prepareVellumBackupClaim({ subjectDid: SUBJECT_DID, payload: PAYLOAD,
    issuedAt: new Date(2_000_000_000_000), nonce: `0x${'55'.repeat(32)}` }, {}, CONFIGURATION, {
    createSigner: async () => ({ signOnlyTransaction: async () => ccc.Transaction.from({ version: 1 }) }),
    writeClaim: async () => ({ tx: transaction, claimId: `0x${'66'.repeat(32)}`, outputIndex: 2,
      issuerSource: { kind: 'input', inputIndex: 0, outputIndex: 0 }, controllerInputIndex: 0 }),
  }), /changed the prepared transaction/);
});

test('issuer signer must control the live issuer DID', async () => {
  const signer = { getAddressObjs: async () => [{ script: LOCK }] };
  const dependencies = { createSigner: () => signer,
    resolveDid: async () => ({ cell: { cellOutput: { lock: LOCK } } }) };
  assert.equal(await createVellumIssuerSigner({}, CONFIGURATION, dependencies), signer);
  await assert.rejects(createVellumIssuerSigner({}, CONFIGURATION, { ...dependencies,
    resolveDid: async () => ({ cell: { cellOutput: { lock: ccc.Script.from({ ...LOCK, args: `0x${'99'.repeat(20)}` }) } } }) }), /does not control/);
  await assert.rejects(createVellumIssuerSigner({}, CONFIGURATION, { ...dependencies, resolveDid: async () => undefined }), /not active/);
});

test('persisted transaction validation rejects incomplete, altered, and unspendable references', () => {
  const transaction = ccc.Transaction.from({
    outputs: [{ lock: LOCK, capacity: ccc.fixedPointFrom(100) }], outputsData: ['0x'],
  });
  const claim = persistedClaim(transaction);
  assert.equal(persistedVellumClaimTransaction(claim).toHex(), transaction.toHex());
  assert.throws(() => persistedVellumClaimTransaction({ ...claim, signedTransaction: null }), /incomplete/);
  assert.throws(() => persistedVellumClaimTransaction({ ...claim, transactionHash: `0x${'aa'.repeat(32)}` }), /does not match/);
  assert.throws(() => persistedVellumClaimTransaction({ ...claim, outputIndex: 1 }), /does not match/);
});

test('uncertain broadcasts reuse exact signed bytes and later confirm the same transaction', async () => {
  const transaction = ccc.Transaction.from({
    outputs: [{ lock: LOCK, capacity: ccc.fixedPointFrom(100) }], outputsData: ['0x'],
  });
  const claim = persistedClaim(transaction);
  const updates = [];
  replace(prisma.vellumBackupClaim, 'updateMany', async value => { updates.push(value); return { count: 1 }; });
  replace(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    vellumIssuerLease: { deleteMany: async () => ({ count: 1 }) },
    vellumBackupClaim: { updateMany: async () => ({ count: 1 }) },
  }));

  const sent = [];
  let lookups = 0;
  const uncertain = {
    getTransaction: async () => { lookups += 1; return undefined; },
    sendTransaction: async candidate => { sent.push(candidate.toHex()); throw new Error('connection closed'); },
  };
  assert.deepEqual(await reconcilePreparedVellumBackupClaim(claim, 'lease-token', uncertain),
    { status: 'pending', repositoryId: 'repository-id' });
  assert.equal(lookups, 2);
  assert.deepEqual(sent, [transaction.toHex()]);
  assert.equal(updates.at(-1).data.lastErrorCode, 'BROADCAST_UNCERTAIN');

  const submitted = {
    getTransaction: async () => undefined,
    sendTransaction: async candidate => { sent.push(candidate.toHex()); return transaction.hash(); },
  };
  assert.deepEqual(await reconcilePreparedVellumBackupClaim(claim, 'lease-token', submitted),
    { status: 'submitted', repositoryId: 'repository-id', transactionHash: transaction.hash() });
  assert.deepEqual(sent, [transaction.toHex(), transaction.toHex()]);

  const confirmed = { getTransaction: async () => ({ status: 'committed', transaction }) };
  assert.deepEqual(await reconcilePreparedVellumBackupClaim(claim, 'lease-token', confirmed),
    { status: 'confirmed', repositoryId: 'repository-id', transactionHash: transaction.hash() });
  assert.equal(updates.at(-1).data.status, 'confirmed');
});

test('issuer lease permits only one active transaction builder and resumes the same claim after expiry', async () => {
  const transaction = ccc.Transaction.from({
    outputs: [{ lock: LOCK, capacity: ccc.fixedPointFrom(100) }], outputsData: ['0x'],
  });
  let claim = { ...persistedClaim(transaction), status: 'prepared', leaseToken: null };
  let lease = null;
  replace(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    vellumIssuerLease: {
      findUnique: async () => lease,
      delete: async () => { lease = null; },
      upsert: async value => {
        lease = lease ? { ...lease, ...value.update, revision: lease.revision + 1 } : { ...value.create, revision: 1 };
        return lease;
      },
    },
    vellumBackupClaim: {
      findUnique: async () => claim,
      findFirst: async () => claim,
      update: async value => { claim = { ...claim, leaseToken: value.data.leaseToken, revision: claim.revision + 1 }; return claim; },
    },
  }));

  const first = await acquireVellumIssuerLease();
  assert.equal(first.claim.repositoryId, claim.repositoryId);
  assert.equal(await acquireVellumIssuerLease(), null);
  lease.expiresAt = new Date(0);
  const resumed = await acquireVellumIssuerLease();
  assert.equal(resumed.claim.repositoryId, claim.repositoryId);
  assert.notEqual(resumed.token, first.token);
});
