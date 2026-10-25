const assert = require('node:assert/strict');
const { afterEach, beforeEach, mock, test } = require('node:test');
const { dispatchBackup, dispatchRestore } = require('../src/lib/backupDispatch.ts');
const { prisma } = require('../src/lib/db.ts');

const environmentNames = ['RIVET_REPO_OWNER', 'RIVET_REPO_NAME', 'RIVET_REPO_REF', 'NEXT_PUBLIC_APP_URL', 'GH_DISPATCH_TOKEN'];
let savedEnvironment;

beforeEach(() => {
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [], workerDispatch: { count: async () => 0, create: async () => ({}) },
  }));
  savedEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    RIVET_REPO_OWNER: 'rivet-operator',
    RIVET_REPO_NAME: 'workers',
    RIVET_REPO_REF: 'main',
    NEXT_PUBLIC_APP_URL: 'https://rivet.example',
  });
  delete process.env.GH_DISPATCH_TOKEN;
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const name of environmentNames) {
    if (savedEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnvironment[name];
  }
});

function restore() {
  return dispatchRestore({ userId: 'user-id', repoName: 'source', ipfsCid: 'test-cid', targetRepoName: 'restored', sessionToken: 'user-credential' });
}

test('missing worker credentials never fall back to a user token for backup or restore', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('No dispatch should be sent'); });
  for (const result of [await dispatchBackup('user/source', 'user-id'), await restore()]) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.match(result.error, /workers are not configured/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('workers use the operator token and only restore receives the user credential', async () => {
  process.env.GH_DISPATCH_TOKEN = 'operator-credential';
  const fetch = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^https:\/\/api.github.com\/repos\/rivet-operator\/workers\/actions\/workflows\//);
    assert.equal(options.headers.Authorization, 'Bearer operator-credential');
    const body = JSON.parse(options.body);
    assert.equal(body.inputs.githubToken, String(url).includes('restore.yml') ? 'user-credential' : undefined);
    assert.equal(body.ref, 'main');
    assert.ok(body.inputs.jobId);
    return new Response(null, { status: 204 });
  });
  assert.equal((await dispatchBackup('user/source', 'user-id')).ok, true);
  assert.equal((await restore()).ok, true);
  assert.equal(fetch.mock.callCount(), 2);
});

test('permission failures identify worker access rather than an invalid user sign-in', async () => {
  process.env.GH_DISPATCH_TOKEN = 'operator-credential';
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: 'Must have admin rights to Repository.' }), { status: 403 }));
  const result = await dispatchBackup('user/source', 'user-id');
  assert.equal(result.ok, false);
  assert.match(result.error, /GitHub denied Rivet permission/);
});
