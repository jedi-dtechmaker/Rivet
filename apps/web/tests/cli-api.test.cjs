const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../src/lib/db.ts');
const { ccc } = require('@ckb-ccc/core');
const { GET } = require('../src/app/api/cli/status/route.ts');
const { POST } = require('../src/app/api/cli/backup/route.ts');
test('CLI requires a GitHub bearer identity and never falls back to a browser account', async () => {
  assert.equal((await GET(new Request('https://rivet.example/api/cli/status?repo=owner/repo'))).status, 401);
  assert.equal((await POST(new Request('https://rivet.example/api/cli/backup', { method: 'POST', body: '{}' }))).status, 401);
});
test('CLI recovery keys are opt-in and scoped to the authenticated repository owner', async () => {
  const txHash = `0x${'ab'.repeat(32)}`, root = `0x${'cd'.repeat(32)}`;
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.github.com/user'); assert.equal(init.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ id: 1001 }) };
  });
  const originalUser = prisma.user.findUnique, originalRepo = prisma.repository.findFirst;
  prisma.user.findUnique = async ({ where }) => { assert.equal(where.githubId, '1001'); return { id: 'owner', githubId: '1001' }; };
  prisma.repository.findFirst = async ({ where }) => {
    assert.equal(where.userId, 'owner'); assert.equal(where.isPrivate, false);
    if (where.githubRepoId !== 'owner/repo') return null;
    return { fullName: 'owner/repo', isBackedUp: true, ckbTxHash: txHash, ckbCellOutpoint: `${txHash}:0`,
      lastBackupCid: `bafy${'a'.repeat(40)}`, commitCount: 2, encryptionKey: 'private-key', encryptionIv: 'private-iv', updatedAt: new Date('2026-10-27T10:00:00Z') };
  };
  mock.method(ccc.Client.prototype, 'getTransaction', async () => ({ status: 'committed', transaction: { outputsData: [root] }, blockHash: txHash }));
  mock.method(ccc.Client.prototype, 'getHeaderByHash', async () => ({ number: 42n }));
  const request = suffix => new Request(`https://rivet.example/api/cli/status?repo=owner/repo${suffix}`, { headers: { Authorization: 'Bearer test-token' } });
  try {
    const regular = await (await GET(request(''))).json();
    assert.equal(regular.status, 'confirmed'); assert.equal(regular.proof.blockHeight, '42');
    assert.equal(regular.proof.encryptionKey, undefined); assert.equal(regular.proof.encryptionIv, undefined);
    const recovery = await GET(request('&includeSecrets=true'));
    assert.equal(recovery.headers.get('Cache-Control'), 'no-store'); assert.equal((await recovery.json()).proof.encryptionKey, 'private-key');
    assert.equal((await GET(new Request('https://rivet.example/api/cli/status?repo=another/repo&includeSecrets=true', { headers: { Authorization: 'Bearer test-token' } }))).status, 404);
    assert.equal((await (await GET(request('&since=2026-10-27T11:00:00Z'))).json()).status, 'pending');
  } finally { prisma.user.findUnique = originalUser; prisma.repository.findFirst = originalRepo; mock.restoreAll(); }
});
