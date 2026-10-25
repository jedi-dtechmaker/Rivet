const assert = require('node:assert/strict');
const test = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { createWalletMessage, parseJoyIdAddress, verifyWalletProof } = require('../src/lib/wallet-proof.ts');
const { signedProof, credentialResponse } = require('./joyid-fixture.cjs');

test('the challenge binds account, wallet, origin, network, expiry and nonce', () => {
  const message = createWalletMessage('https://rivet.example', 'github-123', 'wallet-123', 'nonce-123', new Date('2026-10-21T12:00:00Z'));
  for (const expected of ['https://rivet.example', 'github-123', 'wallet-123', 'nonce-123', 'CKB testnet', '2026-10-21T12:00:00.000Z']) assert.ok(message.includes(expected));
});

test('accepts a valid passkey signature only when the credential belongs to the address', async () => {
  const proof = signedProof('rivet-nonce');
  assert.equal(await verifyWalletProof('rivet-nonce', 'wallet-123', proof, async () => credentialResponse(proof, 'wallet-123')), true);
  assert.equal(await verifyWalletProof('rivet-nonce', 'different-wallet', proof, async () => credentialResponse(proof, 'wallet-123')), false);
});

test('rejects a valid signature for a different challenge before querying credentials', async () => {
  const proof = signedProof('previous-nonce');
  assert.equal(await verifyWalletProof('new-nonce', 'wallet-123', proof, async () => { throw new Error('Credential lookup must not run'); }), false);
});

test('signature fields cannot override the server challenge or verified key', async () => {
  const proof = signedProof('attacker-nonce');
  proof.signature = JSON.stringify({ ...JSON.parse(proof.signature), challenge: 'attacker-nonce', pubkey: JSON.parse(proof.identity).publicKey });
  assert.equal(await verifyWalletProof('server-nonce', 'wallet-123', proof), false);
});

test('rejects malformed proofs, other wallet types, and unbound session keys', async () => {
  assert.equal(await verifyWalletProof('nonce', 'address', null), false);
  assert.equal(await verifyWalletProof('nonce', 'address', { signType: 'EvmPersonal' }), false);
  const proof = signedProof('nonce');
  proof.identity = JSON.stringify({ ...JSON.parse(proof.identity), keyType: 'main_session_key' });
  assert.equal(await verifyWalletProof('nonce', 'address', proof), false);
});

test('credential service failure never grants wallet ownership', async () => {
  const proof = signedProof('nonce');
  await assert.rejects(() => verifyWalletProof('nonce', 'address', proof, async () => new Response('', { status: 503 })), /unavailable/);
});

test('accepts only a valid testnet address with the JoyID lock', async () => {
  const client = new ccc.ClientPublicTestnet();
  const joyId = await ccc.Address.fromKnownScript(client, ccc.KnownScript.JoyId, `0x0001${'12'.repeat(20)}`);
  assert.equal((await parseJoyIdAddress(joyId.toString(), client)).toString(), joyId.toString());
  await assert.rejects(() => parseJoyIdAddress('ckt1invalid', client));
  await assert.rejects(() => parseJoyIdAddress('ckb1invalid', client));
  const native = await ccc.Address.fromKnownScript(client, ccc.KnownScript.Secp256k1Blake160, `0x${'12'.repeat(20)}`);
  await assert.rejects(() => parseJoyIdAddress(native.toString(), client), /JoyID/);
});
