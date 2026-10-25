const assert = require('node:assert/strict');
const { afterEach, beforeEach, mock, test } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { db } = require('../src/lib/db.ts');
const route = require('../src/app/api/user/auto-sync/route.ts');
const names = ['NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'GITHUB_WEBHOOK_SECRET'];
let environment;

beforeEach(() => {
  environment = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { NEXTAUTH_URL: 'https://rivet.example', NEXT_PUBLIC_APP_URL: 'https://rivet.example', GITHUB_WEBHOOK_SECRET: 'test-hook-secret' });
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: '123' }, accessToken: 'user-token' }));
  mock.method(db, 'findUserByGithubId', async () => ({ id: 'user-id' }));
  mock.method(db, 'findReposByUserId', async () => [{ fullName: 'owner/public', isBackedUp: true, isPrivate: false }, { fullName: 'owner/private', isBackedUp: true, isPrivate: true }]);
  mock.method(console, 'log', () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const name of names) {
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
  }
});

function request(enabled) {
  return new NextRequest('https://rivet.example/api/user/auto-sync', { method: 'POST', headers: { Origin: 'https://rivet.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSync: enabled }) });
}

test('Auto Sync reports GitHub webhook failures instead of claiming activation succeeded', async () => {
  const save = mock.method(db, 'updateUserSettings', async () => ({}));
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  assert.equal((await route.POST(request(true))).status, 502);
  assert.equal(save.mock.callCount(), 0);
});

test('Auto Sync installs only public repository hooks and persists activation after GitHub confirms', async () => {
  let installed = false;
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/owner/public/hooks');
    if (options.method === 'POST') { installed = true; return new Response('{}', { status: 201 }); }
    return new Response('[]');
  });
  const save = mock.method(db, 'updateUserSettings', async (id, update) => {
    assert.ok(installed);
    assert.deepEqual(update, { autoSync: true });
    return {};
  });
  assert.equal((await route.POST(request(true))).status, 200);
  assert.equal(save.mock.callCount(), 1);
});

test('missing webhook configuration prevents enabling Auto Sync', async () => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  const save = mock.method(db, 'updateUserSettings', async () => ({}));
  assert.equal((await route.POST(request(true))).status, 503);
  assert.equal(save.mock.callCount(), 0);
});
