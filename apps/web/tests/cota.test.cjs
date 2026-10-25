const assert = require('node:assert/strict');
const { test, mock, afterEach } = require('node:test');
const http = require('node:http');
const { ccc } = require('@ckb-ccc/core');
const { COTA_TESTNET, cotaTypeForLock, createCotaRegistrationTransaction, prepareCotaRegistration } = require('../src/lib/cota.ts');

afterEach(() => mock.restoreAll());

const owner = ccc.Script.from({
  codeHash: `0x${'12'.repeat(32)}`,
  hashType: 'type',
  args: `0x0001${'34'.repeat(20)}`,
});
const registry = ccc.Cell.from({
  outPoint: { txHash: `0x${'56'.repeat(32)}`, index: 0 },
  cellOutput: { lock: COTA_TESTNET.registryLock, type: COTA_TESTNET.registry, capacity: ccc.fixedPointFrom(200) },
  outputData: `0x02${'78'.repeat(32)}`,
});

test('registration preserves the registry cell and locks the sponsored cell to the user', () => {
  const root = 'ab'.repeat(32);
  const transaction = createCotaRegistrationTransaction(registry, owner, root, '1234');
  assert.ok(transaction.inputs[0].previousOutput.eq(registry.outPoint));
  assert.ok(transaction.outputs[0].lock.eq(registry.cellOutput.lock));
  assert.ok(transaction.outputs[0].type.eq(registry.cellOutput.type));
  assert.equal(transaction.outputs[0].capacity, registry.cellOutput.capacity);
  assert.equal(transaction.outputsData[0], `0x02${root}`);
  assert.equal(transaction.getWitnessArgs(0).inputType, '0x1234');
  assert.ok(transaction.outputs[1].lock.eq(owner));
  assert.ok(transaction.outputs[1].type.eq(cotaTypeForLock(owner)));
  assert.equal(transaction.outputsData[1], `0x02${'00'.repeat(32)}`);
  assert.equal(transaction.outputs[1].capacity, ccc.fixedPointFrom(150));
});

test('capacity covers the actual serialized output even for a larger lock', () => {
  const largeOwner = ccc.Script.from({ ...owner, args: `0x${'12'.repeat(100)}` });
  const transaction = createCotaRegistrationTransaction(registry, largeOwner, `0x${'ab'.repeat(32)}`, '0x1234');
  const output = transaction.outputs[1];
  assert.equal(output.capacity, ccc.fixedPointFrom(output.occupiedSize + 33));
});

test('rejects malformed registry roots and proof entries', () => {
  assert.throws(() => createCotaRegistrationTransaction(registry, owner, 'ab', '1234'), /Invalid/);
  assert.throws(() => createCotaRegistrationTransaction(registry, owner, 'ab'.repeat(32), 'not-hex'), /Invalid/);
});

test('each owner has a deterministic CoTA type derived from the owner lock hash', () => {
  const type = cotaTypeForLock(owner);
  assert.equal(type.args, owner.hash().slice(0, 42));
  const another = ccc.Script.from({ ...owner, args: `0x${'cd'.repeat(22)}` });
  assert.notEqual(cotaTypeForLock(another).args, type.args);
});

test('registration is funded and signed entirely by the sponsor while preserving the registry witness', async context => {
  const previousUrl = process.env.COTA_REGISTRY_URL;
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ result: { smt_root_hash: 'ab'.repeat(32), registry_smt_entry: '1234' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.COTA_REGISTRY_URL = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    if (previousUrl === undefined) delete process.env.COTA_REGISTRY_URL;
    else process.env.COTA_REGISTRY_URL = previousUrl;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const client = new ccc.ClientPublicTestnet();
  const sponsor = new ccc.SignerCkbPrivateKey(client, `0x${'01'.repeat(32)}`);
  const sponsorLock = (await sponsor.getRecommendedAddressObj()).script;
  const funds = ccc.Cell.from({
    outPoint: { txHash: `0x${'ef'.repeat(32)}`, index: 0 },
    cellOutput: { lock: sponsorLock, capacity: ccc.fixedPointFrom(1000) },
    outputData: '0x',
  });
  mock.method(client, 'findSingletonCellByType', async () => registry);
  mock.method(client, 'findCells', async function* ({ script }) {
    if (ccc.Script.from(script).eq(sponsorLock)) yield funds;
  });
  mock.method(client, 'getCellLiveNoCache', async () => registry);
  const transaction = await prepareCotaRegistration(client, owner, sponsor);
  assert.equal(transaction.inputs.length, 2);
  assert.ok(transaction.inputs[1].previousOutput.eq(funds.outPoint));
  assert.ok(transaction.outputs[1].lock.eq(owner));
  assert.ok(transaction.outputs.at(-1).lock.eq(sponsorLock));
  assert.equal(transaction.getWitnessArgs(0).inputType, '0x1234');
  assert.ok(transaction.getWitnessArgs(1).lock.length > 100);
  assert.ok((await transaction.getFee(client)) > 0n);
  assert.ok((await transaction.getFee(client)) <= ccc.fixedPointFrom('0.01'));
});
