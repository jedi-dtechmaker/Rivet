const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const { prisma } = require('../src/lib/db.ts');
const { reserveWorkerDispatch } = require('../src/lib/worker-quota.ts');
const { dispatchBackup } = require('../src/lib/backupDispatch.ts');
const names = ['RIVET_WORKER_USER_HOURLY_LIMIT', 'RIVET_WORKER_GLOBAL_HOURLY_LIMIT', 'RIVET_WORKER_GLOBAL_DAILY_LIMIT', 'RIVET_WORKERS_ENABLED', 'RIVET_REPO_OWNER', 'RIVET_REPO_NAME', 'GH_DISPATCH_TOKEN', 'NEXT_PUBLIC_APP_URL'];
const initial = Object.fromEntries(names.map(name => [name, process.env[name]]));

afterEach(() => {
  mock.restoreAll();
  for (const name of names) {
    if (initial[name] === undefined) delete process.env[name];
    else process.env[name] = initial[name];
  }
});

function database(counts) {
  let locked = false;
  const created = [];
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => { locked = true; },
    workerDispatch: {
      count: async ({ where }) => { assert.ok(locked); assert.ok(where.createdAt.gte instanceof Date); return counts.shift(); },
      create: async ({ data }) => { assert.ok(locked); created.push(data); },
    },
  }));
  return created;
}

test('worker budgets reserve a durable account-bound attempt before dispatch', async () => {
  const created = database([0, 0, 0]);
  assert.equal((await reserveWorkerDispatch('account', 'job', 'backup')).allowed, true);
  assert.deepEqual(created, [{ id: 'job', userId: 'account', kind: 'backup' }]);
});

test('per-user, hourly global, and daily global limits each stop spending', async () => {
  for (const counts of [[10], [0, 50], [0, 0, 200]]) {
    const created = database([...counts]);
    assert.equal((await reserveWorkerDispatch('account', 'job', 'restore')).allowed, false);
    assert.equal(created.length, 0);
    mock.restoreAll();
  }
});

test('invalid worker limits fail closed before a transaction starts', async () => {
  process.env.RIVET_WORKER_USER_HOURLY_LIMIT = '0';
  const transaction = mock.method(prisma, '$transaction', async () => { throw new Error('must not start'); });
  await assert.rejects(reserveWorkerDispatch('account', 'job', 'backup'), /Invalid worker limit/);
  assert.equal(transaction.mock.callCount(), 0);
});

test('budget exhaustion, unavailable storage, and the pause switch never dispatch a workflow', async () => {
  Object.assign(process.env, { RIVET_REPO_OWNER: 'operator', RIVET_REPO_NAME: 'workers', GH_DISPATCH_TOKEN: 'operator-token', NEXT_PUBLIC_APP_URL: 'https://rivet.example' });
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('Must not dispatch'); });
  mock.method(console, 'error', () => {});
  database([10]);
  assert.equal((await dispatchBackup('owner/repo', 'account')).status, 429);
  mock.method(prisma, '$transaction', async () => { throw new Error('database down'); });
  assert.equal((await dispatchBackup('owner/repo', 'account')).status, 503);
  process.env.RIVET_WORKERS_ENABLED = 'false';
  assert.equal((await dispatchBackup('owner/repo', 'account')).status, 503);
  assert.equal(fetch.mock.callCount(), 0);
});
