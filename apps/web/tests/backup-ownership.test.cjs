const assert = require('node:assert/strict');
const { afterEach, beforeEach, mock, test } = require('node:test');
const { NextRequest } = require('next/server');
const nextAuth = require('next-auth/next');
const { db, prisma } = require('../src/lib/db.ts');
const backupRoute = require('../src/app/api/backup/route.ts');
const callbackRoute = require('../src/app/api/backup/callback/route.ts');
const { ccc } = require('@ckb-ccc/core');
const { backupFixture } = require('./fixtures/backup-job.cjs');
const { CkbHttpTransport } = require('../src/lib/ckb-server.ts');
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
    $queryRaw: async () => [], workerDispatch: { findFirst: async () => null, count: async () => 0, create: async () => ({}) },
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
  let saved, job;
  const fixture = backupFixture();
  mockModel(prisma.repository, 'upsert', async options => {
    assert.deepEqual(options.update, {});
    saved = { ...options.create, ckbCellOutpoint: null, updatedAt: new Date(0) };
    return saved;
  });
  mock.method(prisma, '$transaction', async callback => callback({
    $queryRaw: async () => [],
    workerDispatch: {
      findFirst: async () => null, count: async () => 0,
      create: async ({ data }) => { job = { ...data, state: 'queued', createdAt: new Date() }; },
      findUniqueOrThrow: async () => job,
      update: async ({ data }) => Object.assign(job, data),
    },
    repository: { findFirst: async () => saved, updateMany: async ({ where, data }) => {
      assert.equal(where.userId, 'requester-db-id');
      saved = { ...saved, ...data, updatedAt: new Date(Date.now() + 1000) }; return { count: 1 };
    } },
  }));
  mockModel(prisma.workerDispatch, 'findUniqueOrThrow', async () => job);
  mock.method(CkbHttpTransport.prototype, 'request', async payload => ({ jsonrpc: '2.0', id: payload.id, result: {
    tx_status: { status: 'committed', block_hash: `0x${'aa'.repeat(32)}` }, transaction: {
      version: '0x0', cell_deps: [], header_deps: [], inputs: [], witnesses: [], outputs_data: fixture.transaction.outputsData,
      outputs: fixture.transaction.outputs.map(output => ({ capacity: `0x${output.capacity.toString(16)}`,
        lock: { code_hash: output.lock.codeHash, hash_type: output.lock.hashType, args: output.lock.args } })),
    },
  } }));
  mock.method(globalThis, 'fetch', async url => {
    if (url === 'https://api.github.com/repos/requester/testing') return Response.json({ private: false, full_name: 'requester/testing', permissions: { push: true } });
    assert.equal(saved.userId, 'requester-db-id');
    return new Response(null, { status: 204 });
  });
  mock.method(db, 'findRepo', async () => saved);
  mock.method(db, 'findFirstUser', async () => { throw new Error('Must never choose an arbitrary account'); });
  const started = await backupRoute.POST(request('/api/backup', { repoFullName: 'requester/testing', isPrivate: false }));
  assert.equal(started.status, 202);
  const dispatch = await started.json();
  job.state = 'prepared'; job.checkpoint = fixture.saved;
  await require('../src/lib/backup-jobs.ts').completeBackupJob(job.id, 'requester/testing', fixture.saved.txHash);
  const completed = await callbackRoute.POST(request('/api/backup/callback', {
    jobId: dispatch.jobId, repoFullName: 'requester/testing', success: true, ckbTxHash: fixture.saved.txHash,
  }));
  assert.equal(completed.status, 200);
  const status = await statusRoute.GET(new NextRequest(`https://rivet.example/api/backup/status?repoFullName=requester/testing&since=${encodeURIComponent(dispatch.startedAt)}`));
  assert.equal((await status.json()).status, 'done');
  assert.equal(saved.userId, 'requester-db-id'); assert.equal(saved.ckbTxHash, fixture.saved.txHash);
  assert.equal(saved.isPrivate, false); assert.equal(saved.isBackedUp, true);
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
