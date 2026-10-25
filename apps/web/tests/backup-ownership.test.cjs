const assert = require('node:assert/strict');
const { afterEach, beforeEach, mock, test } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { db, prisma } = require('../src/lib/db.ts');
const backupRoute = require('../src/app/api/backup/route.ts');
const callbackRoute = require('../src/app/api/backup/callback/route.ts');
const statusRoute = require('../src/app/api/backup/status/route.ts');

const environmentNames = ['RIVET_REPO_OWNER', 'RIVET_REPO_NAME', 'NEXT_PUBLIC_APP_URL', 'NEXTAUTH_URL', 'GH_DISPATCH_TOKEN', 'BACKUP_CALLBACK_SECRET'];
let savedEnvironment;
const modelRestorations = [];

beforeEach(() => {
  savedEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    RIVET_REPO_OWNER: 'operator', RIVET_REPO_NAME: 'workers',
    NEXT_PUBLIC_APP_URL: 'https://rivet.example', GH_DISPATCH_TOKEN: 'operator-token',
    NEXTAUTH_URL: 'https://rivet.example',
    BACKUP_CALLBACK_SECRET: 'test-callback-secret',
  });
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-requester' }, accessToken: 'user-token' }));
  mock.method(db, 'findUserByGithubId', async () => ({ id: 'requester-db-id' }));
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [], workerDispatch: { count: async () => 0, create: async () => ({}) },
  }));
});

afterEach(() => {
  mock.restoreAll();
  while (modelRestorations.length) modelRestorations.pop()();
  for (const name of environmentNames) {
    if (savedEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnvironment[name];
  }
});

function mockModel(model, method, implementation) {
  const original = model[method];
  model[method] = mock.fn(implementation);
  modelRestorations.push(() => { model[method] = original; });
  return model[method];
}

function request(path, body) {
  return new NextRequest(`https://rivet.example${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-backup-secret': 'test-callback-secret', Origin: 'https://rivet.example' },
    body: JSON.stringify(body),
  });
}

test('backup completion remains attached to the requesting account when the dashboard reloads', async () => {
  let saved;
  mockModel(prisma.repository, 'upsert', async options => {
    assert.deepEqual(options.update, {});
    saved = { ...options.create, updatedAt: new Date(0) };
    return saved;
  });
  mock.method(globalThis, 'fetch', async url => {
    if (url === 'https://api.github.com/repos/requester/testing') return new Response(JSON.stringify({ private: false, full_name: 'requester/testing', permissions: { push: true } }));
    assert.equal(saved.userId, 'requester-db-id');
    assert.equal(saved.isPrivate, false);
    assert.equal(saved.isBackedUp, false);
    return new Response(null, { status: 204 });
  });
  mock.method(db, 'findRepo', async () => saved);
  mock.method(db, 'updateRepo', async (name, data) => {
    saved = { ...saved, ...data, updatedAt: new Date(Date.now() + 1000) };
    return saved;
  });
  mock.method(db, 'findFirstUser', async () => { throw new Error('Must never choose an arbitrary account'); });

  const started = await backupRoute.POST(request('/api/backup', { repoFullName: 'requester/testing', isPrivate: false }));
  assert.equal(started.status, 202);
  const dispatch = await started.json();
  const completed = await callbackRoute.POST(request('/api/backup/callback', {
    jobId: dispatch.jobId, repoFullName: 'requester/testing', success: true,
    ipfsCid: 'backup-cid', ckbTxHash: 'backup-transaction',
  }));
  assert.equal(completed.status, 200);

  const status = await statusRoute.GET(new NextRequest(`https://rivet.example/api/backup/status?repoFullName=requester/testing&since=${encodeURIComponent(dispatch.startedAt)}`));
  assert.equal((await status.json()).status, 'done');
  mockModel(prisma.repository, 'findMany', async options => {
    assert.equal(options.where.userId, 'requester-db-id');
    return saved.userId === options.where.userId ? [saved] : [];
  });
  const repos = await db.findReposByUserId('requester-db-id');
  assert.equal(repos.length, 1);
  assert.equal(repos[0].isBackedUp, true);
  assert.equal(repos[0].ckbTxHash, 'backup-transaction');
  assert.equal(repos[0].isPrivate, false);
});

test('another account cannot take ownership of an existing backup', async () => {
  mockModel(prisma.repository, 'upsert', async options => {
    assert.deepEqual(options.update, {});
    return { userId: 'different-account' };
  });
  const fetch = mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://api.github.com/repos/owner/testing');
    return new Response(JSON.stringify({ private: false, full_name: 'owner/testing', permissions: { push: true } }));
  });
  const response = await backupRoute.POST(request('/api/backup', { repoFullName: 'owner/testing' }));
  assert.equal(response.status, 403);
  assert.equal(fetch.mock.callCount(), 1);
});

test('a callback without a registered repository never assigns it to the first user', async () => {
  mock.method(db, 'findRepo', async () => null);
  const firstUser = mock.method(db, 'findFirstUser', async () => { throw new Error('Must never choose an arbitrary account'); });
  const response = await callbackRoute.POST(request('/api/backup/callback', {
    repoFullName: 'owner/testing', success: true, ipfsCid: 'backup-cid', ckbTxHash: 'backup-transaction',
  }));
  assert.equal(response.status, 409);
  assert.equal(firstUser.mock.callCount(), 0);
});

test('backup polling cannot expose another account\'s saved proofs', async () => {
  mock.method(db, 'findRepo', async () => ({ userId: 'different-account', isBackedUp: true, ckbTxHash: 'private-proof' }));
  const response = await statusRoute.GET(new NextRequest('https://rivet.example/api/backup/status?repoFullName=owner/testing'));
  assert.deepEqual(await response.json(), { status: 'pending' });
});
