const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test, mock } = require('node:test');
const databaseUrl = process.env.RIVET_TEST_DATABASE_URL;

test('wallet linking and registration retries persist safely in PostgreSQL', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { NextRequest } = require('next/server');
  const nextAuth = require('next-auth/next');
  const { ccc } = require('@ckb-ccc/core');
  const { Prisma } = require('@prisma/client');
  const { prisma } = require('../src/lib/db.ts');
  const walletRoute = require('../src/app/api/user/sync-wallet/route.ts');
  const cotaRoute = require('../src/app/api/user/cota/route.ts');
  const { signedProof, credentialResponse } = require('./joyid-fixture.cjs');
  const githubId = `local-test-${randomUUID()}`;
  const owner = await ccc.Address.fromKnownScript(new ccc.ClientPublicTestnet(), ccc.KnownScript.JoyId, `0x0001${randomUUID().replaceAll('-', '').padEnd(40, '0')}`);
  const address = owner.toString();
  const origin = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000').origin;
  function request(path, body) {
    return new NextRequest(`${origin}${path}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }
  const user = await prisma.user.create({ data: { githubId } });

  try {
    const challenge = await prisma.walletChallenge.create({ data: {
      userId: user.id, address, message: randomUUID(), expiresAt: new Date(Date.now() + 60000),
    } });
    const proof = signedProof(challenge.message);
    mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: githubId } }));
    mock.method(globalThis, 'fetch', async () => credentialResponse(proof, address));
    const linked = await Promise.all([
      walletRoute.POST(request('/api/user/sync-wallet', { challengeId: challenge.id, proof })),
      walletRoute.POST(request('/api/user/sync-wallet', { challengeId: challenge.id, proof })),
    ]);
    assert.equal(linked.filter(response => response.status === 200).length, 1);
    assert.ok(linked.some(response => [400, 503].includes(response.status)));
    const savedUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(savedUser.ckbAddress, address);
    assert.ok(savedUser.ckbAddressVerifiedAt);
    assert.equal(await prisma.walletChallenge.count({ where: { userId: user.id } }), 0);

    const transaction = ccc.Transaction.from({
      outputs: [{ lock: owner.script, capacity: ccc.fixedPointFrom(150) }], outputsData: ['0x'],
    });
    await prisma.cotaRegistration.create({ data: {
      userId: user.id, address, txHash: transaction.hash(), outputIndex: 0,
      transaction: JSON.parse(transaction.stringify()), status: 'prepared',
    } });
    assert.equal(await prisma.cotaRegistration.count({ where: { userId: user.id, transaction: { not: Prisma.DbNull } } }), 1);
    mock.method(ccc.ClientPublicTestnet.prototype, 'getTransaction', async () => undefined);
    const broadcasts = [];
    mock.method(ccc.ClientPublicTestnet.prototype, 'sendTransaction', async supplied => {
      broadcasts.push(supplied.hash());
      if (broadcasts.length === 1) throw new Error('Simulated interrupted broadcast');
      return supplied.hash();
    });
    assert.equal((await cotaRoute.POST(request('/api/user/cota', {}))).status, 503);
    assert.equal((await cotaRoute.POST(request('/api/user/cota', {}))).status, 202);
    const registration = await prisma.cotaRegistration.findUnique({ where: { userId: user.id } });
    assert.equal(registration.status, 'submitted');
    assert.equal(broadcasts[0], broadcasts[1]);
    assert.equal(await prisma.cotaRegistration.count({ where: { userId: user.id } }), 1);
  } finally {
    mock.restoreAll();
    await prisma.cotaRegistration.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
