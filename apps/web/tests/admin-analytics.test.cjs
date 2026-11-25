const assert = require('node:assert/strict');
const { test, mock, afterEach } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { prisma } = require('../src/lib/db.ts');
const { authOptions } = require('../src/lib/auth.ts');
const { isAdminGithubId, trackedPage } = require('../src/lib/analytics-policy.ts');
const analyticsRoute = require('../src/app/api/analytics/route.ts');
require.extensions['.css'] = () => {};
const AdminPage = require('../src/app/admin/page.tsx').default;

const originalEnabled = process.env.RIVET_ANALYTICS_ENABLED;
const originalUrl = process.env.NEXTAUTH_URL;
afterEach(() => {
  mock.restoreAll();
  if (originalEnabled === undefined) delete process.env.RIVET_ANALYTICS_ENABLED;
  else process.env.RIVET_ANALYTICS_ENABLED = originalEnabled;
  if (originalUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalUrl;
});

function request(body, origin = 'https://rivet.test') {
  return new NextRequest('https://rivet.test/api/analytics', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('admin access fails closed and uses exact numeric GitHub IDs', () => {
  assert.equal(isAdminGithubId('123', undefined), false);
  assert.equal(isAdminGithubId(undefined, '123'), false);
  assert.equal(isAdminGithubId('123', '1234'), false);
  assert.equal(isAdminGithubId('123', '456, 123'), true);
  assert.equal(isAdminGithubId('alice', 'alice'), false);
  assert.equal(isAdminGithubId('123 ', '123'), false);
});

test('admin page denies missing and unapproved sessions before reading data', async () => {
  const oldAdminIds = process.env.RIVET_ADMIN_GITHUB_IDS;
  process.env.RIVET_ADMIN_GITHUB_IDS = '123';
  const session = mock.method(nextAuth, 'getServerSession', async () => null);
  const originalCount = prisma.user.count;
  let reads = 0;
  prisma.user.count = async () => { reads += 1; return 0; };
  try {
    await assert.rejects(AdminPage(), error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
    session.mock.mockImplementation(async () => ({ user: { id: '456' } }));
    await assert.rejects(AdminPage(), error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
    assert.equal(reads, 0);
  } finally {
    prisma.user.count = originalCount;
    if (oldAdminIds === undefined) delete process.env.RIVET_ADMIN_GITHUB_IDS;
    else process.env.RIVET_ADMIN_GITHUB_IDS = oldAdminIds;
  }
});

test('analytics only accepts selected page categories and same-origin requests', async () => {
  process.env.RIVET_ANALYTICS_ENABLED = 'true';
  process.env.NEXTAUTH_URL = 'https://rivet.test';
  const write = mock.method(prisma, '$executeRaw', async () => 1);
  assert.equal(trackedPage('/admin'), null);
  assert.equal(trackedPage('/alice/private-repo'), null);
  assert.equal((await analyticsRoute.POST(request({ page: 'home' }, 'https://other.test'))).status, 403);
  assert.equal((await analyticsRoute.POST(request({ page: '/alice/private-repo' }))).status, 400);
  assert.equal((await analyticsRoute.POST(request({ page: 'home', token: 'secret' }))).status, 400);
  assert.equal(write.mock.callCount(), 0);
  assert.equal((await analyticsRoute.POST(request({ page: 'home' }))).status, 204);
  assert.equal(write.mock.callCount(), 1);
});

test('dashboard tracking uses the authenticated session, not a supplied identity', async () => {
  process.env.RIVET_ANALYTICS_ENABLED = 'true';
  process.env.NEXTAUTH_URL = 'https://rivet.test';
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: '123' } }));
  const write = mock.method(prisma, '$executeRaw', async () => 1);
  assert.equal((await analyticsRoute.POST(request({ page: 'dashboard', userId: 'other' }))).status, 400);
  assert.equal((await analyticsRoute.POST(request({ page: 'dashboard' }))).status, 204);
  assert.equal(write.mock.callCount(), 2);
  assert.equal(write.mock.calls[1].arguments[1], '123');
});

test('GitHub sign-in fails when identity or account persistence fails', async () => {
  process.env.RIVET_ANALYTICS_ENABLED = 'false';
  const original = prisma.user.upsert;
  try {
    prisma.user.upsert = async () => { throw new Error('database unavailable'); };
    const signIn = authOptions.callbacks.signIn;
    assert.equal(await signIn({ profile: undefined }), false);
    assert.equal(await signIn({ profile: { id: 'bad' } }), false);
    assert.equal(await signIn({ profile: { id: 123, login: 'example' } }), false);
    prisma.user.upsert = async () => ({ id: 'user-id' });
    assert.equal(await signIn({ profile: { id: 123, login: 'example' } }), true);
    process.env.RIVET_ANALYTICS_ENABLED = 'true';
    mock.method(prisma, '$executeRaw', async () => { throw new Error('analytics unavailable'); });
    assert.equal(await signIn({ profile: { id: 123, login: 'example' } }), true);
  } finally {
    prisma.user.upsert = original;
  }
});
