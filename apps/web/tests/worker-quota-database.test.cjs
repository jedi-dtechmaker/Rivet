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
