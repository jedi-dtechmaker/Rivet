const assert = require('node:assert/strict');
const { test, mock, afterEach } = require('node:test');
const { prisma } = require('../src/lib/db.ts');
const { prepareBackupJob, completeBackupJob } = require('../src/lib/backup-jobs.ts');
const { reserveWorkerDispatch } = require('../src/lib/worker-quota.ts');
const { backupFixture } = require('./fixtures/backup-job.cjs');
const jobRoute = require('../src/app/api/backup/job/route.ts');
afterEach(() => mock.restoreAll());

function storage(previous = null) {
  const job = { id: 'job', kind: 'backup', userId: 'owner', repository: 'owner/project', previousOutpoint: previous, state: 'queued', checkpoint: null, dirty: false };
  let head = previous, writes = 0;
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    workerDispatch: {
      findUniqueOrThrow: async () => ({ ...job }),
      update: async ({ data }) => Object.assign(job, data),
    },
    repository: { updateMany: async ({ where, data }) => {
      assert.equal(where.userId, 'owner');
      if (where.ckbCellOutpoint !== head) return { count: 0 };
      head = data.ckbCellOutpoint; writes++; return { count: 1 };
    } },
  }));
  const original = prisma.workerDispatch.findUniqueOrThrow;
  prisma.workerDispatch.findUniqueOrThrow = mock.fn(async () => ({ ...job }));
  return { job, advance: value => { head = value; }, writes: () => writes,
    restore: () => { prisma.workerDispatch.findUniqueOrThrow = original; } };
}

test('signed checkpoint is immutable across retries and callbacks cannot regress an advanced repository', async () => {
  const previous = `0x${'88'.repeat(32)}:0`, db = storage(previous);
  try {
    const fixture = backupFixture(previous);
    assert.deepEqual(await prepareBackupJob('job', 'Owner/project', fixture.saved), fixture.saved);
    assert.deepEqual(await prepareBackupJob('job', 'owner/project', { invalid: 'second signed transaction' }), fixture.saved);
    await assert.rejects(completeBackupJob('job', 'owner/project', `0x${'99'.repeat(32)}`, async () => {}), /differs/);
    db.advance('newer-head');
    await assert.rejects(completeBackupJob('job', 'owner/project', fixture.saved.txHash, async () => {}), /predecessor advanced/);
    assert.equal(db.writes(), 0);
    db.advance(previous);
    assert.equal((await completeBackupJob('job', 'owner/project', fixture.saved.txHash, async () => {})).replayed, false);
    assert.equal((await completeBackupJob('job', 'owner/project', fixture.saved.txHash, async () => {})).replayed, true);
    assert.equal(db.writes(), 1);
  } finally { db.restore(); }
});

test('a checkpoint cannot change the source anchor, recovery material or repository job', async () => {
  const previous = `0x${'88'.repeat(32)}:0`, db = storage(previous);
  try {
    const fixture = backupFixture();
    await assert.rejects(prepareBackupJob('job', 'foreign/project', fixture.saved), /not active/);
    await assert.rejects(prepareBackupJob('job', 'owner/project', fixture.saved), /predecessor/);
    const changed = backupFixture(previous).saved;
    changed.result.ipfsCid = `bafy${'b'.repeat(40)}`;
    await assert.rejects(prepareBackupJob('job', 'owner/project', changed), /differs/);
    assert.equal(db.job.state, 'queued');
  } finally { db.restore(); }
});

test('active jobs coalesce new push deliveries; replayed delivery IDs return their original job without spending again', async () => {
  const job = { id: 'active', userId: 'owner', createdAt: new Date(), state: 'prepared' };
  const deliveries = new Map(); let dirty = 0;
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    backupDelivery: { findUnique: async ({ where }) => deliveries.get(where.id), create: async ({ data }) => deliveries.set(data.id, data) },
    workerDispatch: { findFirst: async () => job, findUniqueOrThrow: async () => job,
      update: async () => { dirty++; }, count: async () => { throw new Error('duplicate jobs must not consume quota'); } },
  }));
  for (let i = 0; i < 2; i++) {
    const result = await reserveWorkerDispatch('owner', 'new-job', 'backup', { repository: 'Owner/project', deliveryId: 'push-event' });
    assert.equal(result.existing.id, 'active');
  }
  assert.equal(dirty, 1);
});

test('backup checkpoints require the worker credential and never expose recovery material publicly', async () => {
  const response = await jobRoute.GET(new Request('https://rivet.example/api/backup/job?jobId=job&repo=owner/project'));
  assert.equal(response.status, 401);
  assert.doesNotMatch(JSON.stringify(await response.json()), /checkpoint|encryptionKey/);
});
