const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

test('PostgreSQL serializes Rivet claim issuance and enforces one durable claim per repository', {
  skip: !process.env.RIVET_TEST_DATABASE_URL,
}, async () => {
  process.env.DATABASE_URL = process.env.RIVET_TEST_DATABASE_URL;
  const { argsToDid } = require('@ckb-ccc/did-ckb');
  const { prisma } = require('../src/lib/db.ts');
  const { acquireVellumIssuerLease, deferVellumBackupClaimPreparation } = require('../src/lib/vellum-backup-claims.ts');
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { githubId: `vellum-${suffix}` } });
  const repositories = await Promise.all(['first', 'second'].map(name => prisma.repository.create({ data: {
    githubRepoId: `owner/${name}-${suffix}`, fullName: `owner/${name}-${suffix}`, name: `${name}-${suffix}`, userId: user.id,
  } })));
  const base = {
    userId: user.id,
    subjectDid: argsToDid(`0x${'11'.repeat(20)}`),
    issuerDid: argsToDid(`0x${'22'.repeat(20)}`),
    schemaHash: `0x${'33'.repeat(32)}`,
    nonce: `0x${'44'.repeat(32)}`,
    payload: { repository: repositories[0].fullName },
    issuedAt: new Date(),
  };
  try {
    await prisma.vellumIssuerLease.deleteMany({ where: { key: 'repository-backup' } });
    await prisma.vellumBackupClaim.create({ data: { ...base, repositoryId: repositories[0].id } });
    await assert.rejects(prisma.vellumBackupClaim.create({ data: { ...base, repositoryId: repositories[0].id } }));
    await prisma.vellumBackupClaim.create({ data: { ...base, repositoryId: repositories[1].id,
      nonce: `0x${'55'.repeat(32)}`, payload: { repository: repositories[1].fullName } } });

    const leases = await Promise.all(Array.from({ length: 8 }, () => acquireVellumIssuerLease()));
    const acquired = leases.filter(Boolean);
    assert.equal(acquired.length, 1);
    assert.equal(await prisma.vellumIssuerLease.count({ where: { key: 'repository-backup' } }), 1);
    assert.equal(await prisma.vellumBackupClaim.count({ where: { leaseToken: { not: null } } }), 1);

    assert.deepEqual(await deferVellumBackupClaimPreparation(acquired[0].claim, acquired[0].token, 'ANCHOR_PENDING'),
      { status: 'pending', repositoryId: acquired[0].claim.repositoryId });
    const next = await acquireVellumIssuerLease();
    assert.ok(next);
    assert.notEqual(next.claim.repositoryId, acquired[0].claim.repositoryId);

    await prisma.vellumIssuerLease.update({ where: { key: 'repository-backup' }, data: { expiresAt: new Date(0) } });
    const resumed = await Promise.all(Array.from({ length: 4 }, () => acquireVellumIssuerLease()));
    const reacquired = resumed.filter(Boolean);
    assert.equal(reacquired.length, 1);
    assert.equal(reacquired[0].claim.repositoryId, next.claim.repositoryId);
    assert.notEqual(reacquired[0].token, next.token);
    await prisma.vellumBackupClaim.updateMany({
      where: { userId: user.id },
      data: { status: 'review_required', lastErrorCode: 'ANCHOR_INVALID' },
    });
  } finally {
    await prisma.vellumIssuerLease.deleteMany({ where: { key: 'repository-backup' } });
    await prisma.vellumBackupClaim.deleteMany({ where: { userId: user.id } });
    await prisma.repository.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
