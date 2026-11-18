const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

test('PostgreSQL serializes simultaneous account and global worker reservations', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.RIVET_TEST_DATABASE_URL;
  const { prisma } = require('../src/lib/db.ts');
  const { reserveWorkerDispatch } = require('../src/lib/worker-quota.ts');
  const first = await prisma.user.create({ data: { githubId: `quota-first-${randomUUID()}` } });
  const second = await prisma.user.create({ data: { githubId: `quota-second-${randomUUID()}` } });
  const names = ['RIVET_WORKER_USER_HOURLY_LIMIT', 'RIVET_WORKER_GLOBAL_HOURLY_LIMIT', 'RIVET_WORKER_GLOBAL_DAILY_LIMIT'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { RIVET_WORKER_USER_HOURLY_LIMIT: '3', RIVET_WORKER_GLOBAL_HOURLY_LIMIT: '4', RIVET_WORKER_GLOBAL_DAILY_LIMIT: '6' });
  try {
    const attempts = await Promise.all(Array.from({ length: 8 }, () => reserveWorkerDispatch(first.id, randomUUID(), 'backup')));
    assert.equal(attempts.filter(result => result.allowed).length, 3);
    assert.equal(await prisma.workerDispatch.count({ where: { userId: first.id } }), 3);
    const other = await Promise.all(Array.from({ length: 4 }, () => reserveWorkerDispatch(second.id, randomUUID(), 'restore')));
    assert.equal(other.filter(result => result.allowed).length, 1);
    assert.equal(await prisma.workerDispatch.count({ where: { userId: second.id } }), 1);
  } finally {
    await prisma.workerDispatch.deleteMany({ where: { userId: { in: [first.id, second.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await prisma.$disconnect();
  }
});

test('PostgreSQL coalesces concurrent pushes, preserves one signed checkpoint and applies a callback once', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.RIVET_TEST_DATABASE_URL;
  const { prisma } = require('../src/lib/db.ts');
  const { reserveWorkerDispatch } = require('../src/lib/worker-quota.ts');
  const { prepareBackupJob, completeBackupJob } = require('../src/lib/backup-jobs.ts');
  const { backupFixture } = require('./fixtures/backup-job.cjs');
  const user = await prisma.user.create({ data: { githubId: `sync-${randomUUID()}` } });
  const repository = `owner/sync-${randomUUID()}`;
  await prisma.repository.create({ data: { githubRepoId: repository, fullName: repository, name: repository.split('/')[1], userId: user.id } });
  const deliveries = Array.from({ length: 6 }, () => randomUUID());
  try {
    const reservations = await Promise.all(deliveries.map(deliveryId => reserveWorkerDispatch(user.id, randomUUID(), 'backup', { repository, deliveryId })));
    assert.equal(reservations.filter(result => !result.existing).length, 1);
    assert.equal(await prisma.workerDispatch.count({ where: { repository } }), 1);
    const job = await prisma.workerDispatch.findFirstOrThrow({ where: { repository } });
    assert.equal(job.dirty, true);
    const fixture = backupFixture();
    const saved = await Promise.all(Array.from({ length: 4 }, () => prepareBackupJob(job.id, repository, fixture.saved)));
    assert.ok(saved.every(value => value.txHash === fixture.saved.txHash));
    const completed = await Promise.all(Array.from({ length: 4 }, () => completeBackupJob(job.id, repository, fixture.saved.txHash, async () => {})));
    assert.equal(completed.filter(result => !result.replayed).length, 1);
    const repo = await prisma.repository.findUniqueOrThrow({ where: { githubRepoId: repository } });
    assert.equal(repo.ckbCellOutpoint, fixture.saved.result.ckbCellOutpoint);
    const replay = await reserveWorkerDispatch(user.id, randomUUID(), 'backup', { repository, deliveryId: deliveries[0] });
    assert.equal(replay.existing.id, job.id);
    await Promise.all(Array.from({ length: 4 }, () => reserveWorkerDispatch(user.id, randomUUID(), 'backup', {
      repository, previousOutpoint: repo.ckbCellOutpoint, deliveryId: `followup:${job.id}`,
    })));
    assert.equal(await prisma.workerDispatch.count({ where: { repository } }), 2);
    const next = await prisma.workerDispatch.findFirstOrThrow({ where: { repository, state: 'queued' } });
    assert.equal(next.previousOutpoint, repo.ckbCellOutpoint);
  } finally {
    await prisma.backupDelivery.deleteMany({ where: { repository } });
    await prisma.workerDispatch.deleteMany({ where: { userId: user.id } });
    await prisma.repository.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
