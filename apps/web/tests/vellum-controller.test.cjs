const assert = require('node:assert/strict');
const test = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { argsToDid } = require('@ckb-ccc/did-ckb');
const { canonicalVellumDid, resolveVellumController, verifyVellumControllerSignature } = require('../src/lib/vellum-controller.ts');

async function fixture(privateKey = `0x${'11'.repeat(32)}`) {
  const client = { addressPrefix: 'ckt', getKnownScript: async () => ({
    codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
    hashType: 'type', cellDeps: [],
  }) };
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const lock = (await signer.getAddressObjSecp256k1()).script;
  const did = argsToDid(`0x${'22'.repeat(20)}`);
  const record = { did, cell: { cellOutput: { lock } }, data: { value: { document: { services: {} } } } };
  const dependencies = { createClient: () => client, resolveDid: async () => record,
    verifyMessage: ccc.Signer.verifyMessage, verifyJoyIdCredential: async () => false };
  return { client, signer, lock, did, dependencies };
}

test('controller proof accepts a valid signature only from the live DID controller', async () => {
  const value = await fixture();
  const controller = await resolveVellumController(value.did, value.dependencies);
  const signed = await value.signer.signMessage('Rivet identity challenge');
  assert.equal(await verifyVellumControllerSignature('Rivet identity challenge', controller, signed, value.dependencies), true);

  const other = await fixture(`0x${'33'.repeat(32)}`);
  const wrong = await other.signer.signMessage('Rivet identity challenge');
  assert.equal(await verifyVellumControllerSignature('Rivet identity challenge', controller, wrong, value.dependencies), false);
  assert.equal(await verifyVellumControllerSignature('different challenge', controller, signed, value.dependencies), false);
});

test('DID resolution rejects inactive, unavailable, and non-canonical identities', async () => {
  const value = await fixture();
  assert.equal(canonicalVellumDid(value.did), value.did);
  assert.throws(() => canonicalVellumDid(value.did.toUpperCase()), /canonical/);
  await assert.rejects(resolveVellumController(value.did, { ...value.dependencies, resolveDid: async () => null }), /not active/);
  await assert.rejects(resolveVellumController(value.did, { ...value.dependencies, resolveDid: async () => { throw new Error('RPC body'); } }), /could not be resolved/);
});
