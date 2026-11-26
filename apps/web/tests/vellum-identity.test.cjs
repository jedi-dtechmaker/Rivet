const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { argsToDid } = require('@ckb-ccc/did-ckb');
const { prisma } = require('../src/lib/db.ts');
const { createVellumIdentityChallenge, completeVellumIdentityChallenge } = require('../src/lib/vellum-identity.ts');

const replacements = [];
function replace(target, key, implementation) {
  replacements.push([target, key, target[key]]);
  target[key] = mock.fn(implementation);
}
afterEach(() => {
  for (const [target, key, original] of replacements.splice(0).reverse()) target[key] = original;
  mock.restoreAll();
});

const NOW = new Date('2026-11-26T12:00:00.000Z');
const DID = argsToDid(`0x${'11'.repeat(20)}`);
const LOCK = ccc.Script.from({ codeHash: `0x${'22'.repeat(32)}`, hashType: 'type', args: `0x${'33'.repeat(20)}` });
const SIGNATURE = { identity: `0x${'44'.repeat(33)}`, signature: `0x${'55'.repeat(65)}`, signType: 'CkbSecp256k1' };

function dependencies(lock = LOCK, verified = true) {
  return { now: () => new Date(NOW), nonce: () => 'challenge-id',
    resolveController: async () => ({ did: DID, lock, document: {}, client: {} }),
    verifySignature: async () => verified };
}

test('identity challenge binds the immutable account, origin, DID, controller, nonce, and expiry', async () => {
  let saved;
  replace(prisma.user, 'findUnique', async () => ({ githubId: '1001' }));
  replace(prisma.vellumDidChallenge, 'upsert', async value => { saved = value.update; return value.update; });
  const challenge = await createVellumIdentityChallenge('user-id', DID, 'https://rivet.example', dependencies());
  assert.equal(challenge.challengeId, 'challenge-id');
  assert.equal(challenge.expiresAt.toISOString(), '2026-11-26T12:05:00.000Z');
  for (const value of ['https://rivet.example', '1001', DID, LOCK.hash(), 'challenge-id', '2026-11-26T12:05:00.000Z']) {
    assert.ok(challenge.message.includes(value));
  }
  assert.equal(saved.controllerLockHash, LOCK.hash());
  assert.equal(saved.message, challenge.message);
});

test('identity linking rechecks the controller, consumes the challenge once, and preserves explicit visibility', async () => {
  let challenge = { id: 'challenge-id', userId: 'user-id', did: DID, controllerLockHash: LOCK.hash(),
    message: 'signed challenge', expiresAt: new Date('2026-11-26T12:05:00.000Z') };
  let binding;
  replace(prisma.vellumDidChallenge, 'findUnique', async () => challenge);
  replace(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    vellumDidChallenge: {
      findUnique: async () => challenge,
      deleteMany: async () => { if (!challenge) return { count: 0 }; challenge = null; return { count: 1 }; },
    },
    vellumIdentityBinding: { upsert: async value => { binding = value.update; return value.update; } },
  }));
  const result = await completeVellumIdentityChallenge({ userId: 'user-id', challengeId: 'challenge-id', signature: SIGNATURE, isPublic: true }, dependencies());
  assert.equal(result.isPublic, true);
  assert.equal(binding.did, DID);
  assert.equal(binding.controllerLockHash, LOCK.hash());
  await assert.rejects(completeVellumIdentityChallenge({ userId: 'user-id', challengeId: 'challenge-id', signature: SIGNATURE, isPublic: true }, dependencies()), /expired/);
});

test('controller rotation and invalid wallet signatures cannot create a binding', async () => {
  const challenge = { id: 'challenge-id', userId: 'user-id', did: DID, controllerLockHash: LOCK.hash(),
    message: 'signed challenge', expiresAt: new Date('2026-11-26T12:05:00.000Z') };
  replace(prisma.vellumDidChallenge, 'findUnique', async () => challenge);
  const rotated = ccc.Script.from({ codeHash: LOCK.codeHash, hashType: LOCK.hashType, args: `0x${'66'.repeat(20)}` });
  await assert.rejects(completeVellumIdentityChallenge({ userId: 'user-id', challengeId: 'challenge-id', signature: SIGNATURE, isPublic: false }, dependencies(rotated)), /controller changed/);
  await assert.rejects(completeVellumIdentityChallenge({ userId: 'user-id', challengeId: 'challenge-id', signature: SIGNATURE, isPublic: false }, dependencies(LOCK, false)), /does not control/);
});
