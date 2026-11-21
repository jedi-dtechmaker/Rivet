const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../src/lib/db.ts');
const { ccc } = require('@ckb-ccc/core');
const { GET } = require('../src/app/api/cli/status/route.ts');
const { POST } = require('../src/app/api/cli/backup/route.ts');
const { encodeBackupAnchor } = require('../../../packages/cli/src/anchor.mjs');
const { GET: accountGET } = require('../src/app/api/cli/account/route.ts');
const { backupFixture } = require('./fixtures/backup-job.cjs');
test('CLI requires a GitHub bearer identity and never falls back to a browser account', async () => {
  assert.equal((await GET(new Request('https://rivet.example/api/cli/status?repo=owner/repo'))).status, 401);
  assert.equal((await POST(new Request('https://rivet.example/api/cli/backup', { method: 'POST', body: '{}' }))).status, 401);
  const account = await accountGET(new Request('https://rivet.example/api/cli/account'));
  assert.equal(account.status, 401); assert.equal(account.headers.get('Cache-Control'), 'no-store');
});
test('CLI sign-in rejects unknown accounts and keeps upstream failures private', async () => {
  const originalUser = prisma.user.findUnique;
  const request = () => new Request('https://rivet.example/api/cli/account', { headers: { Authorization: 'Bearer test-token' } });
  const upstream = mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ id: 9999 }) }));
  prisma.user.findUnique = async () => null;
  try {
    const unknown = await accountGET(request());
    assert.equal(unknown.status, 401); assert.equal(unknown.headers.get('Cache-Control'), 'no-store');
    upstream.mock.mockImplementation(async () => { throw new Error('private upstream content and test-token'); });
    const unavailable = await accountGET(request());
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('Cache-Control'), 'no-store');
    assert.doesNotMatch(JSON.stringify(await unavailable.json()), /private upstream|test-token/);
  } finally { prisma.user.findUnique = originalUser; mock.restoreAll(); }
});
test('CLI recovery keys are opt-in and scoped to the authenticated repository owner', async () => {
  const txHash = `0x${'ab'.repeat(32)}`, root = `0x${'cd'.repeat(32)}`;
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.github.com/user'); assert.equal(init.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ id: 1001 }) };
  });
  const originalUser = prisma.user.findUnique, originalRepo = prisma.repository.findFirst;
  prisma.user.findUnique = async ({ where }) => { assert.equal(where.githubId, '1001'); return { id: 'owner', githubId: '1001', githubUsername: 'Developer', ckbAddress: 'private-wallet' }; };
  prisma.repository.findFirst = async ({ where }) => {
    assert.equal(where.userId, 'owner'); assert.equal(where.isPrivate, false);
    if (where.githubRepoId !== 'owner/repo') return null;
    return { fullName: 'owner/repo', isBackedUp: true, ckbTxHash: txHash, ckbCellOutpoint: `${txHash}:0`,
      lastBackupCid: `bafy${'a'.repeat(40)}`, commitCount: 2, encryptionKey: 'private-key', encryptionIv: 'private-iv', updatedAt: new Date('2026-10-27T10:00:00Z') };
  };
  let anchorData = root;
  mock.method(ccc.Client.prototype, 'getTransaction', async () => ({ status: 'committed', transaction: { outputsData: [anchorData], outputs: [{}], hash: () => txHash }, blockHash: txHash }));
  mock.method(ccc.Client.prototype, 'getHeaderByHash', async () => ({ number: 42n }));
  const request = suffix => new Request(`https://rivet.example/api/cli/status?repo=owner/repo${suffix}`, { headers: { Authorization: 'Bearer test-token' } });
  try {
    const identity = await accountGET(new Request('https://rivet.example/api/cli/account', { headers: { Authorization: 'Bearer test-token' } }));
    assert.equal(identity.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await identity.json(), { githubId: '1001', username: 'Developer' });
    const regular = await (await GET(request(''))).json();
    assert.equal(regular.status, 'confirmed'); assert.equal(regular.proof.blockHeight, '42');
    assert.equal(regular.proof.encryptionKey, undefined); assert.equal(regular.proof.encryptionIv, undefined);
    const recovery = await GET(request('&includeSecrets=true'));
    assert.equal(recovery.headers.get('Cache-Control'), 'no-store'); assert.equal((await recovery.json()).proof.encryptionKey, 'private-key');
    assert.equal((await GET(new Request('https://rivet.example/api/cli/status?repo=another/repo&includeSecrets=true', { headers: { Authorization: 'Bearer test-token' } }))).status, 404);
    assert.equal((await (await GET(request('&since=2026-10-27T11:00:00Z'))).json()).status, 'pending');
    anchorData = encodeBackupAnchor({ merkleRoot: root, refsHash: `0x${'11'.repeat(32)}`, bundleSha256: `0x${'22'.repeat(32)}`,
      commitCount: 2, ipfsCid: `bafy${'a'.repeat(40)}` });
    const v2 = await (await GET(request(''))).json();
    assert.equal(v2.proof.protocol, 'rivet-backup-proof-v2'); assert.equal(v2.proof.merkleRoot, root);
    assert.equal(v2.proof.refsHash, `0x${'11'.repeat(32)}`); assert.equal(v2.proof.bundleSha256, `0x${'22'.repeat(32)}`);
    assert.equal(v2.proof.encryptionKey, undefined);
    anchorData = encodeBackupAnchor({ merkleRoot: root, refsHash: `0x${'11'.repeat(32)}`, bundleSha256: `0x${'22'.repeat(32)}`,
      commitCount: 3, ipfsCid: `bafy${'a'.repeat(40)}` });
    assert.equal((await GET(request(''))).status, 503);
  } finally { prisma.user.findUnique = originalUser; prisma.repository.findFirst = originalRepo; mock.restoreAll(); }
});

test('CLI job polling returns the reused snapshot even after a later backup, without exposing recovery keys by default', async () => {
  const fixture = backupFixture(), originalUser = prisma.user.findUnique, originalRepo = prisma.repository.findFirst;
  const originalJob = prisma.workerDispatch.findFirst;
  let state = 'unchanged', exists = true;
  mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ id: 1001 }) }));
  prisma.user.findUnique = async () => ({ id: 'owner', githubId: '1001' });
  prisma.repository.findFirst = async () => ({ fullName: 'owner/repo', isBackedUp: true, ckbTxHash: `0x${'99'.repeat(32)}`,
    ckbCellOutpoint: `0x${'99'.repeat(32)}:0`, lastBackupCid: 'newer-cid', commitCount: 3, updatedAt: new Date('2026-11-20T00:00:00Z') });
  prisma.workerDispatch.findFirst = async ({ where }) => {
    assert.deepEqual(where, { id: 'selected-job', userId: 'owner', repository: 'owner/repo', kind: 'backup' });
    return exists ? { state, checkpoint: { ...fixture.saved, unchanged: true } } : null;
  };
  mock.method(ccc.Client.prototype, 'getTransaction', async hash => {
    assert.equal(hash, fixture.saved.txHash); return { status: 'committed', transaction: fixture.transaction, blockHash: hash };
  });
  mock.method(ccc.Client.prototype, 'getHeaderByHash', async () => ({ number: 42n }));
  const request = suffix => new Request(`https://rivet.example/api/cli/status?repo=owner/repo&jobId=selected-job&since=2026-11-21T00:00:00Z${suffix}`, {
    headers: { Authorization: 'Bearer test-token' },
  });
  try {
    const response = await GET(request('')), result = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(result.status, 'confirmed'); assert.equal(result.unchanged, true); assert.equal(result.proof.txHash, fixture.saved.txHash);
    assert.equal(result.proof.encryptionKey, undefined);
    assert.equal((await (await GET(request('&includeSecrets=true'))).json()).proof.encryptionKey, fixture.saved.result.encryptionKey);
    state = 'queued'; assert.equal((await (await GET(request(''))).json()).status, 'pending');
    state = 'failed'; assert.equal((await (await GET(request(''))).json()).status, 'failed');
    exists = false; assert.equal((await GET(request('&includeSecrets=true'))).status, 404);
  } finally {
    prisma.user.findUnique = originalUser; prisma.repository.findFirst = originalRepo; prisma.workerDispatch.findFirst = originalJob; mock.restoreAll();
  }
});
