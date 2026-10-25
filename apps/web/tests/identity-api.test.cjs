const assert = require('node:assert/strict');
const { afterEach, test, mock } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { ccc } = require('@ckb-ccc/core');
const { prisma } = require('../src/lib/db.ts');
const walletRoute = require('../src/app/api/user/sync-wallet/route.ts');
const challengeRoute = require('../src/app/api/user/sync-wallet/challenge/route.ts');
const cotaRoute = require('../src/app/api/user/cota/route.ts');
const { signedProof, credentialResponse } = require('./joyid-fixture.cjs');

const modelRestorations = [];
afterEach(() => {
  mock.restoreAll();
  while (modelRestorations.length) modelRestorations.pop()();
});

function mockModel(model, method, implementation) {
  const original = model[method];
  model[method] = mock.fn(implementation);
  modelRestorations.push(() => { model[method] = original; });
  return model[method];
}

function request(path, body = {}, origin = 'http://localhost:3000') {
  const configured = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000').origin;
  return new NextRequest(`${configured}${path}`, {
    method: 'POST',
    headers: { Origin: origin === 'http://localhost:3000' ? configured : origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('wallet and CoTA endpoints require GitHub authentication', async () => {
  mock.method(nextAuth, 'getServerSession', async () => null);
  for (const response of await Promise.all([
    walletRoute.GET(),
    walletRoute.POST(request('/api/user/sync-wallet')),
    challengeRoute.POST(request('/api/user/sync-wallet/challenge')),
    cotaRoute.GET(),
    cotaRoute.POST(request('/api/user/cota')),
  ])) assert.equal(response.status, 401);
});

test('signed-in users cannot link wallets or trigger sponsorship from another origin', async () => {
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  for (const route of [walletRoute, challengeRoute, cotaRoute]) {
    const response = await route.POST(request('/api/user/cota', {}, 'https://attacker.example'));
    assert.equal(response.status, 403);
  }
});

test('the old address-only request cannot create a verified wallet link', async () => {
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  const response = await walletRoute.POST(request('/api/user/sync-wallet', { ckbAddress: 'address-only' }));
  assert.equal(response.status, 400);
});

test('expired and consumed challenges cannot link an identity', async () => {
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => ({ id: 'user-123' }));
  const lookup = mockModel(prisma.walletChallenge, 'findUnique', async () => ({ id: 'challenge-123', expiresAt: new Date(0) }));
  assert.equal((await walletRoute.POST(request('/api/user/sync-wallet', { challengeId: 'challenge-123' }))).status, 400);
  lookup.mock.mockImplementation(async () => null);
  assert.equal((await walletRoute.POST(request('/api/user/sync-wallet', { challengeId: 'challenge-123' }))).status, 400);
});

test('registration refuses an unverified address before contacting the chain or sponsor', async () => {
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ id: 'user-123', ckbAddress: 'unverified', ckbAddressVerifiedAt: null }) },
  }));
  const response = await cotaRoute.POST(request('/api/user/cota'));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Verify your JoyID wallet first/);
});

test('successful linking consumes the challenge and rejects its replay', async () => {
  const challenge = { id: 'single-use', userId: 'user-123', address: 'wallet-123', message: 'signed-account-link', expiresAt: new Date(Date.now() + 60000) };
  const proof = signedProof(challenge.message);
  let remainingChallenge = challenge;
  let linkedUser = null;
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => ({ id: 'user-123' }));
  mockModel(prisma.walletChallenge, 'findUnique', async () => remainingChallenge);
  mock.method(globalThis, 'fetch', async () => credentialResponse(proof, challenge.address));
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    cotaRegistration: { findUnique: async () => null },
    walletChallenge: { deleteMany: async () => { remainingChallenge = null; return { count: 1 }; } },
    user: { update: async ({ data }) => { linkedUser = data; } },
  }));
  const response = await walletRoute.POST(request('/api/user/sync-wallet', { challengeId: challenge.id, proof }));
  assert.equal(response.status, 200);
  assert.equal(linkedUser.ckbAddress, challenge.address);
  assert.ok(linkedUser.ckbAddressVerifiedAt instanceof Date);
  assert.equal((await walletRoute.POST(request('/api/user/sync-wallet', { challengeId: challenge.id, proof }))).status, 400);
});

test('a challenge consumed by a concurrent request cannot update the user', async () => {
  const challenge = { id: 'single-use', address: 'wallet-123', message: 'concurrent-link', expiresAt: new Date(Date.now() + 60000) };
  const proof = signedProof(challenge.message);
  let updates = 0;
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => ({ id: 'user-123' }));
  mockModel(prisma.walletChallenge, 'findUnique', async () => challenge);
  mock.method(globalThis, 'fetch', async () => credentialResponse(proof, challenge.address));
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    cotaRegistration: { findUnique: async () => null },
    walletChallenge: { deleteMany: async () => ({ count: 0 }) },
    user: { update: async () => { updates += 1; } },
  }));
  assert.equal((await walletRoute.POST(request('/api/user/sync-wallet', { challengeId: challenge.id, proof }))).status, 503);
  assert.equal(updates, 0);
});

test('a failed broadcast retries the persisted transaction without another subsidy', async () => {
  const transaction = ccc.Transaction.from({
    outputs: [{ lock: { codeHash: `0x${'12'.repeat(32)}`, hashType: 'type', args: '0x' }, capacity: ccc.fixedPointFrom(150) }],
    outputsData: ['0x'],
  });
  let record = {
    userId: 'user-123', address: 'verified-wallet', txHash: transaction.hash(), outputIndex: 0,
    transaction: JSON.parse(transaction.stringify()), status: 'prepared',
  };
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ id: record.userId, ckbAddress: record.address, ckbAddressVerifiedAt: new Date() }) },
    cotaRegistration: { findUnique: async () => record },
  }));
  mockModel(prisma.cotaRegistration, 'update', async ({ data }) => { record = { ...record, ...data }; return record; });
  mock.method(ccc.ClientPublicTestnet.prototype, 'getTransaction', async () => undefined);
  const broadcasts = [];
  mock.method(ccc.ClientPublicTestnet.prototype, 'sendTransaction', async supplied => {
    broadcasts.push(supplied.stringify());
    if (broadcasts.length === 1) throw new Error('Timeout');
    return supplied.hash();
  });
  assert.equal((await cotaRoute.POST(request('/api/user/cota'))).status, 503);
  assert.equal(record.status, 'prepared');
  assert.equal((await cotaRoute.POST(request('/api/user/cota'))).status, 202);
  assert.equal(record.status, 'submitted');
  assert.equal(broadcasts[0], broadcasts[1]);
  assert.equal((await cotaRoute.POST(request('/api/user/cota'))).status, 202);
  assert.equal(broadcasts[1], broadcasts[2]);
});

test('reconnecting and retrying a confirmed activation preserves the identity without another subsidy', async () => {
  const record = { userId: 'user-123', address: 'verified-wallet', txHash: `0x${'aa'.repeat(32)}`, outputIndex: 1, status: 'confirmed' };
  const user = { id: record.userId, ckbAddress: record.address, ckbAddressVerifiedAt: new Date() };
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => user);
  mockModel(prisma.cotaRegistration, 'findUnique', async () => record);
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [], user: { findUnique: async () => user },
    cotaRegistration: { findUnique: async () => record },
  }));
  mock.method(ccc.ClientPublicTestnet.prototype, 'getTransaction', async () => ({ status: 'committed' }));
  const broadcast = mock.method(ccc.ClientPublicTestnet.prototype, 'sendTransaction', async () => { throw new Error('Must not broadcast'); });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wallet = await walletRoute.GET();
    assert.deepEqual(await wallet.json(), { address: record.address, verified: true });
    const refreshed = await cotaRoute.GET();
    assert.equal((await refreshed.json()).registration.txHash, record.txHash);
    const retry = await cotaRoute.POST(request('/api/user/cota'));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).registration.txHash, record.txHash);
  }
  assert.equal(broadcast.mock.callCount(), 0);
});

test('a temporarily unknown RPC transaction cannot demote a confirmed registration', async () => {
  const record = { userId: 'user-123', address: 'verified-wallet', txHash: `0x${'aa'.repeat(32)}`, outputIndex: 1, status: 'confirmed' };
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => ({ id: record.userId }));
  mockModel(prisma.cotaRegistration, 'findUnique', async () => record);
  mock.method(ccc.ClientPublicTestnet.prototype, 'getTransaction', async () => undefined);
  const response = await cotaRoute.GET();
  assert.equal((await response.json()).registration.status, 'confirmed');
});

test('confirmed registration remains available while testnet RPC is unreachable', async () => {
  const record = { userId: 'user-123', address: 'verified-wallet', txHash: `0x${'aa'.repeat(32)}`, outputIndex: 1, status: 'confirmed' };
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => ({ id: record.userId }));
  mockModel(prisma.cotaRegistration, 'findUnique', async () => record);
  const lookup = mock.method(ccc.ClientPublicTestnet.prototype, 'getTransaction', async () => { throw new TypeError('fetch failed'); });
  const response = await cotaRoute.GET();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).registration.status, 'confirmed');
  assert.equal(lookup.mock.callCount(), 0);
});

test('reconnecting a different wallet cannot replace a registered identity', async () => {
  const challenge = { id: 'new-wallet', userId: 'user-123', address: 'different-wallet', message: 'wallet-replacement', expiresAt: new Date(Date.now() + 60000) };
  const proof = signedProof(challenge.message);
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-123' } }));
  mockModel(prisma.user, 'findUnique', async () => ({ id: 'user-123' }));
  mockModel(prisma.walletChallenge, 'findUnique', async () => challenge);
  mock.method(globalThis, 'fetch', async () => credentialResponse(proof, challenge.address));
  let writes = 0;
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    cotaRegistration: { findUnique: async () => ({ address: 'original-wallet' }) },
    user: { update: async () => { writes += 1; } },
  }));
  assert.equal((await walletRoute.POST(request('/api/user/sync-wallet', { challengeId: challenge.id, proof }))).status, 503);
  assert.equal(writes, 0);
});
