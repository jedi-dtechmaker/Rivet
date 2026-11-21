const assert = require('node:assert/strict');
const { test, mock, afterEach } = require('node:test');
const { prisma } = require('../src/lib/db.ts');
const { ccc } = require('@ckb-ccc/core');
const { parseBackupAnchor } = require('../../../packages/cli/src/anchor.mjs');
const { prepareBackupJob, completeBackupJob, completeUnchangedBackupJob } = require('../src/lib/backup-jobs.ts');
const { reserveWorkerDispatch } = require('../src/lib/worker-quota.ts');
const { backupFixture } = require('./fixtures/backup-job.cjs');
const jobRoute = require('../src/app/api/backup/job/route.ts');
const callbackRoute = require('../src/app/api/backup/callback/route.ts');
afterEach(() => mock.restoreAll());

function storage(previous = null, repository = {}) {
  const job = { id: 'job', kind: 'backup', userId: 'owner', repository: 'owner/project', previousOutpoint: previous, state: 'queued', checkpoint: null, dirty: false };
  let head = previous, writes = 0;
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    workerDispatch: {
      findUniqueOrThrow: async () => ({ ...job }),
      update: async ({ data }) => Object.assign(job, data),
    },
    repository: { findFirst: async () => ({ ...repository, ckbCellOutpoint: head }), updateMany: async ({ where, data }) => {
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

function unchangedFixture() {
  const fixture = backupFixture();
  const anchor = parseBackupAnchor(fixture.transaction.outputsData[0]);
  const snapshot = { merkleRoot: anchor.merkleRoot, refsHash: anchor.refsHash, commitCount: anchor.commitCount, githubNumericId: '1001' };
  const repository = { isBackedUp: true, ckbTxHash: fixture.saved.txHash, lastBackupCid: anchor.ipfsCid, commitCount: anchor.commitCount,
    encryptionKey: fixture.saved.result.encryptionKey, encryptionIv: fixture.saved.result.encryptionIv, githubNumericId: '1001' };
  mock.method(ccc.ClientPublicTestnet, 'new', () => ({
    getTransactionNoCache: async () => ({ status: 'committed', transaction: fixture.transaction }),
    getCellLive: async () => ccc.Cell.from({ outPoint: { txHash: fixture.saved.txHash, index: 0 },
      cellOutput: fixture.transaction.outputs[0], outputData: fixture.transaction.outputsData[0] }),
  }));
  return { ...fixture, snapshot, repository };
}

test('a repeat after completion reuses the prior backup without changing its anchor or recovery keys, and callback replay remains safe', async () => {
  const fixture = unchangedFixture(), db = storage(fixture.saved.result.ckbCellOutpoint, fixture.repository);
  db.job.dirty = true;
  try {
    const completed = await completeUnchangedBackupJob('job', 'Owner/project', fixture.saved.txHash, fixture.snapshot);
    assert.equal(completed.replayed, false); assert.equal(completed.job.state, 'unchanged'); assert.equal(completed.job.dirty, true);
    assert.equal(completed.result.ckbCellOutpoint, fixture.saved.result.ckbCellOutpoint);
    assert.equal(completed.result.encryptionKey, fixture.repository.encryptionKey); assert.equal(db.writes(), 0);
    db.advance('newer-head');
    assert.equal((await completeUnchangedBackupJob('job', 'owner/project', fixture.saved.txHash, fixture.snapshot)).replayed, true);
    await assert.rejects(completeUnchangedBackupJob('job', 'owner/project', fixture.saved.txHash, { ...fixture.snapshot, refsHash: `0x${'99'.repeat(32)}` }), /differs/);
    await assert.rejects(prepareBackupJob('job', 'owner/project', backupFixture().saved), /not active/);
    assert.equal(db.writes(), 0);
  } finally { db.restore(); }
});

test('changed refs, missing recovery keys, replaced repositories and advanced heads cannot be marked unchanged', async () => {
  const fixture = unchangedFixture();
  const cases = [
    { snapshot: { ...fixture.snapshot, refsHash: `0x${'99'.repeat(32)}` } },
    { repository: { ...fixture.repository, encryptionKey: null } },
    { repository: { ...fixture.repository, githubNumericId: '2002' } },
    { advanced: true },
    { prepared: true },
    { repositoryName: 'foreign/project' },
  ];
  for (const scenario of cases) {
    const db = storage(fixture.saved.result.ckbCellOutpoint, scenario.repository || fixture.repository);
    if (scenario.advanced) db.advance('newer-head');
    if (scenario.prepared) { db.job.state = 'prepared'; db.job.checkpoint = fixture.saved; }
    try {
      await assert.rejects(completeUnchangedBackupJob('job', scenario.repositoryName || 'owner/project', fixture.saved.txHash, scenario.snapshot || fixture.snapshot));
      assert.equal(db.job.state, scenario.prepared ? 'prepared' : 'queued'); assert.equal(db.writes(), 0);
    } finally { db.restore(); }
  }
});

test('unchanged worker callbacks require authentication and finish idempotently without a replacement transaction', async () => {
  const fixture = unchangedFixture(), db = storage(fixture.saved.result.ckbCellOutpoint, fixture.repository);
  const previousSecret = process.env.BACKUP_CALLBACK_SECRET;
  process.env.BACKUP_CALLBACK_SECRET = 'test-unchanged-worker-secret';
  const request = authorized => new Request('https://rivet.example/api/backup/callback', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { 'x-backup-secret': process.env.BACKUP_CALLBACK_SECRET } : {}) },
    body: JSON.stringify({ jobId: 'job', repoFullName: 'owner/project', success: true, unchanged: true,
      ckbTxHash: fixture.saved.txHash, snapshot: fixture.snapshot }),
  });
  try {
    assert.equal((await callbackRoute.POST(request(false))).status, 401); assert.equal(db.job.state, 'queued');
    assert.deepEqual(await (await callbackRoute.POST(request(true))).json(), { acknowledged: true, success: true, replayed: false, unchanged: true });
    assert.deepEqual(await (await callbackRoute.POST(request(true))).json(), { acknowledged: true, success: true, replayed: true, unchanged: true });
    assert.equal(db.writes(), 0); assert.equal(db.job.state, 'unchanged');
  } finally {
    db.restore();
    if (previousSecret === undefined) delete process.env.BACKUP_CALLBACK_SECRET;
    else process.env.BACKUP_CALLBACK_SECRET = previousSecret;
  }
});
