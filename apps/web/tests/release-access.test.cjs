const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { afterEach, beforeEach, mock, test } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { db, prisma } = require('../src/lib/db.ts');
const backupRoute = require('../src/app/api/backup/route.ts');
const restoreRoute = require('../src/app/api/restore/route.ts');
const updateRoute = require('../src/app/api/repo/update/route.ts');
const webhookRoute = require('../src/app/api/webhook/github/route.ts');
const restorations = [];
const names = ['NEXTAUTH_URL', 'GITHUB_WEBHOOK_SECRET', 'RIVET_REPO_OWNER', 'RIVET_REPO_NAME', 'GH_DISPATCH_TOKEN', 'NEXT_PUBLIC_APP_URL'];
let environment;

function model(target, name, implementation) {
  const previous = target[name];
  target[name] = mock.fn(implementation);
  restorations.push(() => { target[name] = previous; });
  return target[name];
}

beforeEach(() => {
  environment = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { NEXTAUTH_URL: 'https://rivet.example', NEXT_PUBLIC_APP_URL: 'https://rivet.example', GITHUB_WEBHOOK_SECRET: 'webhook-secret', RIVET_REPO_OWNER: 'operator', RIVET_REPO_NAME: 'workers', GH_DISPATCH_TOKEN: 'operator-token' });
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: '123' }, accessToken: 'user-token' }));
  mock.method(db, 'findUserByGithubId', async () => ({ id: 'requester' }));
  mock.method(console, 'error', () => {});
  mock.method(console, 'log', () => {});
  mock.method(prisma, '$transaction', async callback => callback({ $queryRaw: async () => [], workerDispatch: { count: async () => 0, create: async () => ({}) } }));
});

afterEach(() => {
  mock.restoreAll();
  while (restorations.length) restorations.pop()();
  for (const name of names) {
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
  }
});

function request(route, body, origin = 'https://rivet.example') {
  return new NextRequest(`https://rivet.example${route}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('client flags cannot bypass GitHub private repository checks', async () => {
  const writes = model(prisma.repository, 'upsert', async () => { throw new Error('must not write'); });
  const fetch = mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://api.github.com/repos/owner/private');
    return new Response(JSON.stringify({ private: true, full_name: 'owner/private' }));
  });
  const result = await backupRoute.POST(request('/api/backup', { repoFullName: 'owner/private', isPrivate: false }));
  assert.equal(result.status, 403);
  assert.match((await result.json()).error, /Private repository backups are disabled/);
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 1);
});

test('backups require GitHub ownership or write permission and reject malformed metadata', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ private: false, full_name: 'owner/public', owner: { id: 456 }, permissions: { push: false } })));
  assert.equal((await backupRoute.POST(request('/api/backup', { repoFullName: 'owner/public' }))).status, 403);
  fetch.mock.restore();
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ full_name: 'owner/public' })));
  assert.equal((await backupRoute.POST(request('/api/backup', { repoFullName: 'owner/public' }))).status, 502);
});

test('backup and restore mutations reject foreign origins before any GitHub request', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not call GitHub'); });
  for (const route of [backupRoute, restoreRoute]) assert.equal((await route.POST(request('/api/action', {}, 'https://foreign.example'))).status, 403);
  assert.equal(fetch.mock.callCount(), 0);
});

test('the obsolete client proof update endpoint cannot change database records', async () => {
  const write = mock.method(db, 'updateRepo', async () => { throw new Error('must not write'); });
  assert.equal((await updateRoute.POST()).status, 410);
  assert.equal(write.mock.callCount(), 0);
});

test('restore reads only the requesting account backup and never dispatches foreign or private keys', async () => {
  model(prisma.repository, 'findFirst', async ({ where }) => {
    assert.deepEqual(where, { userId: 'requester', lastBackupCid: 'private-cid', isBackedUp: true });
    return null;
  });
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not dispatch'); });
  assert.equal((await restoreRoute.POST(request('/api/restore', { repoName: 'private', ipfsCid: 'private-cid' }))).status, 404);
  model(prisma.repository, 'findFirst', async () => ({ isPrivate: true, encryptionKey: 'never-forward-this' }));
  assert.equal((await restoreRoute.POST(request('/api/restore', { repoName: 'private', ipfsCid: 'private-cid' }))).status, 403);
  assert.equal(fetch.mock.callCount(), 0);
});

test('authorized restore forwards only the owned backup and dispatches with the operator credential', async () => {
  model(prisma.repository, 'findFirst', async () => ({ userId: 'requester', name: 'real-source', isPrivate: false, encryptionKey: 'owned-key', encryptionIv: 'owned-iv' }));
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer operator-token');
    const { inputs } = JSON.parse(options.body);
    assert.equal(inputs.repoName, 'real-source');
    assert.equal(inputs.githubToken, 'user-token');
    assert.equal(inputs.encryptionKey, 'owned-key');
    return new Response(null, { status: 204 });
  });
  assert.equal((await restoreRoute.POST(request('/api/restore', { repoName: 'forged-source', ipfsCid: 'owned-cid' }))).status, 202);
});

function webhook(payload) {
  const body = JSON.stringify(payload);
  return new NextRequest('https://rivet.example/api/webhook/github', { method: 'POST', headers: { 'x-github-event': 'push', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}` }, body });
}

test('webhook private repositories and unregistered pushes cannot create or dispatch jobs', async () => {
  mock.method(db, 'findRepo', async () => ({ userId: 'owner', isPrivate: true }));
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not dispatch'); });
  assert.equal((await webhookRoute.POST(webhook({ repository: { full_name: 'owner/private', private: true } }))).status, 403);
  mock.restoreAll();
  mock.method(db, 'findRepo', async () => null);
  const fallback = mock.method(db, 'findFirstUser', async () => { throw new Error('must not choose a random account'); });
  assert.equal((await webhookRoute.POST(webhook({ repository: { full_name: 'owner/public', private: false } }))).status, 200);
  assert.equal(fallback.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('collaborator push events use the registered repository owner rather than the sender', async () => {
  mock.method(db, 'findRepo', async () => ({ userId: 'registered-owner', isPrivate: false, ckbCellOutpoint: 'previous' }));
  model(prisma.user, 'findUnique', async ({ where }) => { assert.deepEqual(where, { id: 'registered-owner' }); return { id: where.id, autoSync: true }; });
  let dispatches = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://api.github.com/repos/owner/public') return new Response(JSON.stringify({ private: false, full_name: 'owner/public' }));
    dispatches++;
    assert.equal(JSON.parse(options.body).inputs.previousOutpoint, 'previous');
    return new Response(null, { status: 204 });
  });
  const response = await webhookRoute.POST(webhook({ repository: { full_name: 'owner/public', private: false }, sender: { id: 999 } }));
  assert.equal(response.status, 202);
  assert.equal(dispatches, 1);
});
