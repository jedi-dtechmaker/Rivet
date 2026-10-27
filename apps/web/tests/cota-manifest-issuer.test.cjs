const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, statSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { ccc } = require('@ckb-ccc/core');
const { COTA_TESTNET, cotaTypeForLock } = require('../src/lib/cota.ts');
const { buildSmt, EMPTY_ROOT } = require('../src/lib/cota-smt.ts');
const { deriveManifestCollectionId, createStandardCotaTransaction } = require('../src/lib/cota-manifest-chain.ts');
const { createManifestIssuerKeyFile, prepareManifestIssuerSetup, submitManifestIssuerSetup, manifestIssuerSetupStatus,
  validateIssuerSetupSigned } = require('../src/lib/cota-manifest-issuer.ts');

const hex = raw => `0x${raw.toString('hex')}`;
const bytes = value => Buffer.from(value.slice(2), 'hex');
const u32 = value => { const raw = Buffer.alloc(4); raw.writeUInt32LE(value); return raw; };
const vector = values => Buffer.concat([u32(values.length), ...values]);
const moleculeBytes = raw => Buffer.concat([u32(raw.length), raw]);
function table(fields) {
  let length = 4 * (fields.length + 1);
  const offsets = fields.map(field => { const previous = length; length += field.length; return u32(previous); });
  return Buffer.concat([u32(length), ...offsets, ...fields]);
}

async function fixture(ownCell = false) {
  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, `0x${'11'.repeat(32)}`);
  const sponsor = new ccc.SignerCkbPrivateKey(client, `0x${'22'.repeat(32)}`);
  const lock = (await signer.getRecommendedAddressObj()).script;
  const sponsorLock = (await sponsor.getRecommendedAddressObj()).script;
  const registry = ccc.Cell.from({ outPoint: { txHash: `0x${'33'.repeat(32)}`, index: 0 },
    cellOutput: { lock: COTA_TESTNET.registryLock, type: COTA_TESTNET.registry, capacity: ccc.fixedPointFrom(1000) }, outputData: `0x02${EMPTY_ROOT.slice(2)}` });
  const cell = ccc.Cell.from({ outPoint: { txHash: `0x${'44'.repeat(32)}`, index: 1 },
    cellOutput: { lock, type: cotaTypeForLock(lock), capacity: ccc.fixedPointFrom(150) }, outputData: `0x02${EMPTY_ROOT.slice(2)}` });
  client.findSingletonCellByType = async type => ccc.Script.from(type).eq(COTA_TESTNET.registry) ? registry : ownCell ? cell : undefined;
  client.getTransaction = async () => ({ status: 'committed' });
  let operation = null;
  const events = [];
  const database = { cotaManifestOperation: {
    findFirst: async () => operation,
    findUnique: async () => operation,
    count: async () => 0,
  }, cotaRegistration: { count: async () => 0 } };
  const store = {
    reconcileHead: async input => { events.push({ kind: 'reconcile', input }); },
    reserve: async input => { events.push({ kind: 'reserve', input }); operation = { id: 'generated-op', userId: null, status: 'building', ...input }; return { existing: false, operation }; },
    commitPlan: async (id, plan) => { events.push({ kind: 'commit', plan }); operation = { ...operation, ...plan, status: 'awaiting_signature' }; return operation; },
    abandonBuild: async () => { events.push({ kind: 'abandon' }); operation = { ...operation, status: 'abandoned' }; },
  };
  const register = async () => {
    events.push({ kind: 'register' });
    const transaction = ccc.Transaction.from({
      inputs: [{ previousOutput: registry.outPoint, cellOutput: registry.cellOutput, outputData: registry.outputData },
        { previousOutput: { txHash: `0x${'55'.repeat(32)}`, index: 0 }, cellOutput: { lock: sponsorLock, capacity: ccc.fixedPointFrom(300) }, outputData: '0x' }],
      outputs: [registry.cellOutput, cell.cellOutput, { lock: sponsorLock, capacity: ccc.fixedPointFrom(150) - 5000n }],
      outputsData: [registry.outputData, cell.outputData, '0x'], witnesses: ['0x', '0x'],
    });
    transaction.setWitnessArgs(0, { inputType: '0x010203' });
    transaction.setWitnessArgs(1, { lock: `0x${'66'.repeat(65)}` });
    return transaction;
  };
  const define = async () => {
    events.push({ kind: 'define' });
    const collectionId = deriveManifestCollectionId(cell);
    const key = Buffer.concat([Buffer.from('8100', 'hex'), bytes(collectionId)]);
    const info = Buffer.concat([Buffer.alloc(8), Buffer.from([0xf7])]);
    const leaf = { key: hex(Buffer.concat([key, Buffer.alloc(10)])), value: hex(Buffer.concat([info, Buffer.alloc(22), Buffer.from([255])])) };
    const tree = buildSmt([leaf]);
    const entry = table([vector([key]), vector([info]), moleculeBytes(tree.proof), moleculeBytes(Buffer.from('Create a new NFT collection with unlimited edition'))]);
    const transaction = createStandardCotaTransaction(cell, tree.root, `0x01${entry.toString('hex')}`);
    transaction.outputs[0].capacity -= 5000n;
    return { transaction, collectionId };
  };
  const issuer = { signer, lock, collectionId: null, limit: 1 };
  const options = { client, database, store, issuer, register, define, registry: async () => ({ registered: false }), refresh: async value => value };
  return { client, database, store, options, issuer, registry, cell, events,
    get operation() { return operation; }, set operation(value) { operation = value; } };
}

test('issuer key creation is private, exclusive, and returns public data only', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rivet-issuer-keys-'));
  const filename = path.join(directory, '.env.cota-manifest-issuer.local');
  try {
    const result = await createManifestIssuerKeyFile(filename);
    const content = readFileSync(filename, 'utf8');
    assert.match(content, /^COTA_MANIFEST_ISSUER_PRIVATE_KEY="0x[0-9a-f]{64}"\n$/);
    assert.deepEqual(Object.keys(result).sort(), ['address', 'filename']);
    assert.match(result.address, /^ckt1/);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    await assert.rejects(() => createManifestIssuerKeyFile(filename), /already exists/);
    assert.equal(readFileSync(filename, 'utf8'), content);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('issuer preparation reserves the registry stream and saves exact sponsored signatures without broadcasting', async () => {
  const old = { key: process.env.COTA_SPONSOR_PRIVATE_KEY, enabled: process.env.COTA_SPONSOR_ENABLED };
  process.env.COTA_SPONSOR_PRIVATE_KEY = `0x${'22'.repeat(32)}`; process.env.COTA_SPONSOR_ENABLED = 'true';
  try {
    const value = await fixture();
    const result = await prepareManifestIssuerSetup(value.options);
    assert.equal(result.stage, 'awaiting_signature');
    assert.equal(result.operation.kind, 'issuer-register');
    assert.equal(value.events[0].input.cotaScriptHash, ccc.Script.from(COTA_TESTNET.registry).hash());
    assert.equal(value.events[1].input.userId, null);
    assert.deepEqual(value.events.map(event => event.kind), ['reconcile', 'reserve', 'register', 'commit']);
    const saved = ccc.Transaction.from(value.operation.unsignedTransaction);
    assert.equal(ccc.hexFrom(saved.toBytes()), value.operation.serializedUnsignedTransaction);
    assert.equal(saved.outputs[1].lock.hash(), value.issuer.lock.hash());
    assert.doesNotThrow(() => validateIssuerSetupSigned(saved, saved, value.operation));
    const altered = saved.clone(); altered.setWitnessArgs(1, { lock: '0x1234' });
    assert.throws(() => validateIssuerSetupSigned(saved, altered, value.operation), /signatures differ/);
    let sent;
    const submitted = await submitManifestIssuerSetup(result.operation.id, { ...value.options, submit: async (id, input) => {
      sent = input; return { ...value.operation, status: 'submitted' };
    } });
    assert.equal(submitted.stage, 'submitted');
    assert.ok(sent.signedTransaction);
    assert.equal(sent.signer, undefined);
    assert.equal(sent.successorOutputIndex, 0, 'The registry successor and newly created issuer output are different positions.');
  } finally {
    if (old.key === undefined) delete process.env.COTA_SPONSOR_PRIVATE_KEY; else process.env.COTA_SPONSOR_PRIVATE_KEY = old.key;
    if (old.enabled === undefined) delete process.env.COTA_SPONSOR_ENABLED; else process.env.COTA_SPONSOR_ENABLED = old.enabled;
  }
});

test('issuer definitions remain unsigned until explicit submission and expose the confirmed collection ID', async () => {
  const value = await fixture(true);
  const result = await prepareManifestIssuerSetup(value.options);
  assert.equal(result.operation.kind, 'issuer-define');
  const saved = ccc.Transaction.from(value.operation.unsignedTransaction);
  assert.equal(saved.getWitnessArgs(0).lock, undefined);
  assert.equal(result.collectionId, deriveManifestCollectionId(value.cell));
  assert.equal(value.events[0].input.cotaScriptHash, cotaTypeForLock(value.issuer.lock).hash());
  let sent;
  await submitManifestIssuerSetup(result.operation.id, { ...value.options, submit: async (_id, input) => {
    sent = input; return { ...value.operation, status: 'submitted' };
  } });
  assert.equal(sent.signer, value.issuer.signer);
  assert.equal(sent.signedTransaction, undefined);
  value.operation = { ...value.operation, status: 'confirmed' };
  const status = await manifestIssuerSetupStatus(undefined, value.options);
  assert.equal(status.collectionId, result.collectionId);
  const repeated = await prepareManifestIssuerSetup(value.options);
  assert.equal(repeated.stage, 'confirmed');
  assert.equal(value.events.filter(event => event.kind === 'define').length, 1);
});

test('setup blocks disabled sponsorship and refuses operations owned by another issuer', async () => {
  const value = await fixture();
  const enabled = process.env.COTA_SPONSOR_ENABLED;
  delete process.env.COTA_SPONSOR_ENABLED;
  try { await assert.rejects(() => prepareManifestIssuerSetup(value.options), /Enable and configure/); }
  finally { if (enabled !== undefined) process.env.COTA_SPONSOR_ENABLED = enabled; }
  value.operation = { id: 'other', userId: null, kind: 'issuer-define', snapshot: { issuerLockHash: EMPTY_ROOT } };
  await assert.rejects(() => submitManifestIssuerSetup('other', value.options), /does not belong/);
  assert.equal(value.events.length, 0);
});

test('a source race abandons only the unpublished build and retains the failed operation', async () => {
  const value = await fixture(true);
  const original = value.options.define;
  value.options.define = async (...args) => {
    const result = await original(...args);
    result.transaction.inputs[0].previousOutput = ccc.OutPoint.from({ txHash: `0x${'99'.repeat(32)}`, index: 0 });
    return result;
  };
  await assert.rejects(() => prepareManifestIssuerSetup(value.options), /source changed/);
  assert.equal(value.operation.status, 'abandoned');
  assert.equal(value.events.some(event => event.kind === 'commit'), false);
});
