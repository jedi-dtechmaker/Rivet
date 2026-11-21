const assert = require('node:assert/strict');
const { afterEach, beforeEach, mock, test } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { db, prisma } = require('../src/lib/db.ts');
const status = require('../src/app/api/backup/status/route.ts');
const jobRoute = require('../src/app/api/backup/job/route.ts');
const restorations = [];
let previousSecret;
function model(target, method, implementation) {
  const original = target[method]; target[method] = mock.fn(implementation);
  restorations.push(() => { target[method] = original; });
  return target[method];
}
function poll() { return new NextRequest('https://rivet.example/api/backup/status?repoFullName=owner/repo&jobId=job-id'); }
function update(body, authorized = true) {
  return new Request('https://rivet.example/api/backup/job', { method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { 'x-backup-secret': 'test-worker-secret' } : {}) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  previousSecret = process.env.BACKUP_CALLBACK_SECRET;
  process.env.BACKUP_CALLBACK_SECRET = 'test-worker-secret';
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-user' } }));
  mock.method(db, 'findUserByGithubId', async () => ({ id: 'account-id' }));
  mock.method(db, 'findRepo', async () => ({ userId: 'account-id', ckbTxHash: 'old-proof' }));
});
afterEach(() => {
  mock.restoreAll(); while (restorations.length) restorations.pop()();
  if (previousSecret === undefined) delete process.env.BACKUP_CALLBACK_SECRET;
  else process.env.BACKUP_CALLBACK_SECRET = previousSecret;
});

test('progress is tied to the account and job without exposing keys or worker URLs', async () => {
  model(prisma.workerDispatch, 'findFirst', async ({ where }) => {
    assert.deepEqual(where, { id: 'job-id', userId: 'account-id', repository: 'owner/repo', kind: 'backup' });
    return { state: 'prepared', progress: 60, checkpoint: { txHash: 'new-proof', result: { encryptionKey: 'never-expose' } } };
  });
  const response = await status.GET(poll());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { status: 'pending', percent: 90, label: 'Waiting for proof confirmation…' });
});

test('100 percent requires the selected job to be confirmed and returns its own proof', async () => {
  model(prisma.workerDispatch, 'findFirst', async () => ({ state: 'completed', progress: 90, checkpoint: { txHash: 'this-job-proof', result: { encryptionKey: 'private' } } }));
  assert.deepEqual(await (await status.GET(poll())).json(), { status: 'done', percent: 100, label: 'Backup complete', ckbTxHash: 'this-job-proof' });
});

test('an interrupted job reports failure rather than an endless loading spinner', async () => {
  model(prisma.workerDispatch, 'findFirst', async () => ({ state: 'failed', progress: 40 }));
  assert.deepEqual(await (await status.GET(poll())).json(), { status: 'failed', percent: 40, label: 'Backup interrupted' });
});

test('an unchanged backup finishes with its existing proof and never exposes saved recovery keys', async () => {
  model(prisma.workerDispatch, 'findFirst', async () => ({ state: 'unchanged', progress: 100,
    checkpoint: { unchanged: true, txHash: 'existing-proof', result: { encryptionKey: 'private' } } }));
  assert.deepEqual(await (await status.GET(poll())).json(), {
    status: 'done', percent: 100, label: 'Already backed up; no changes', ckbTxHash: 'existing-proof', unchanged: true,
  });
});

test('another account and unknown job IDs cannot read progress', async () => {
  const lookup = model(prisma.workerDispatch, 'findFirst', async () => null);
  assert.equal((await status.GET(poll())).status, 404);
  mock.method(db, 'findRepo', async () => ({ userId: 'another-account' }));
  assert.deepEqual(await (await status.GET(poll())).json(), { status: 'pending' });
  assert.equal(lookup.mock.callCount(), 1);
  mock.method(nextAuth, 'getServerSession', async () => null);
  assert.equal((await status.GET(poll())).status, 401);
});

test('only authenticated workers can report known stages, and progress cannot be set to complete', async () => {
  const write = model(prisma.workerDispatch, 'updateMany', async () => ({ count: 1 }));
  const body = { jobId: 'job-id', repo: 'owner/repo', stage: 'uploading' };
  assert.equal((await jobRoute.PATCH(update(body, false))).status, 401);
  for (const stage of ['completed', 'constructor', 100]) assert.equal((await jobRoute.PATCH(update({ ...body, stage }))).status, 400);
  assert.equal(write.mock.callCount(), 0);
});

test('replayed stage reports are monotonic, account for terminal states and cannot mutate signed checkpoints', async () => {
  let stored = 60;
  model(prisma.workerDispatch, 'updateMany', async ({ where, data }) => {
    assert.equal(where.id, 'job-id'); assert.equal(where.repository, 'owner/repo'); assert.equal(where.kind, 'backup');
    assert.deepEqual(where.state, { in: ['queued', 'prepared'] });
    assert.deepEqual(Object.keys(data), ['progress']);
    if (stored < where.progress.lt) stored = data.progress;
    return { count: 1 };
  });
  for (const stage of ['cloning', 'confirming', 'uploading']) assert.equal((await jobRoute.PATCH(update({ jobId: 'job-id', repo: 'OWNER/REPO', stage }))).status, 200);
  assert.equal(stored, 90);
});
