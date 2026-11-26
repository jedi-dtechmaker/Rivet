const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

test('release setup upgrades a legacy schema twice without losing users or backup evidence', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: process.env.RIVET_TEST_DATABASE_URL } } });
  const schema = `release_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.RIVET_TEST_DATABASE_URL);
  url.searchParams.set('schema', schema);
  try {
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await client.$executeRawUnsafe(`CREATE TABLE "${schema}"."User" ("id" TEXT PRIMARY KEY, "githubId" TEXT NOT NULL)`);
    await client.$executeRawUnsafe(`CREATE TABLE "${schema}"."Repository" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "${schema}"."User"("id"), "lastBackupCid" TEXT, "ckbTxHash" TEXT)`);
    await client.$executeRawUnsafe(`INSERT INTO "${schema}"."User" VALUES ('existing-user', 'existing-github-account')`);
    await client.$executeRawUnsafe(`INSERT INTO "${schema}"."Repository" VALUES ('existing-backup', 'existing-user', 'preserved-cid', 'preserved-anchor')`);
    await client.$executeRawUnsafe(`CREATE TABLE "${schema}"."WorkerDispatch" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "${schema}"."User"("id"), "kind" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.$executeRawUnsafe(`INSERT INTO "${schema}"."WorkerDispatch" ("id", "userId", "kind") VALUES ('existing-job', 'existing-user', 'backup')`);
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const script of ['setup-identity.mjs', 'setup-cota-records.mjs', 'setup-worker-dispatch.mjs', 'setup-vellum.mjs']) {
        execFileSync(process.execPath, [path.join(__dirname, '../scripts', script)], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe', timeout: 30000 });
      }
    }
    const users = await client.$queryRawUnsafe(`SELECT "id", "githubId", "ckbAddressVerifiedAt" FROM "${schema}"."User"`);
    assert.deepEqual(users, [{ id: 'existing-user', githubId: 'existing-github-account', ckbAddressVerifiedAt: null }]);
    const backups = await client.$queryRawUnsafe(`SELECT * FROM "${schema}"."Repository"`);
    assert.deepEqual(backups, [{ id: 'existing-backup', userId: 'existing-user', lastBackupCid: 'preserved-cid', ckbTxHash: 'preserved-anchor' }]);
    const jobs = await client.$queryRawUnsafe(`SELECT "id", "state", "progress", "checkpoint" FROM "${schema}"."WorkerDispatch"`);
    assert.deepEqual(jobs, [{ id: 'existing-job', state: 'queued', progress: 0, checkpoint: null }]);
    const tables = await client.$queryRawUnsafe('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', schema);
    for (const table of ['WalletChallenge', 'CotaRegistration', 'CotaUpdate', 'WorkerDispatch', 'VellumDidChallenge',
      'VellumIdentityBinding', 'VellumBackupClaim', 'VellumIssuerLease']) assert.ok(tables.some(row => row.table_name === table));
  } finally {
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.$disconnect();
  }
});
