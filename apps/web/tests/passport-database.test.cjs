const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
test('concurrent passport approval persists one candidate and reconnect does not mint again in PostgreSQL', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.RIVET_TEST_DATABASE_URL;
  process.env.PASSPORT_ENABLED = 'true';
  const { prisma } = require('../src/lib/db.ts');
  const { ccc } = require('@ckb-ccc/core');
  const { getSporeScriptInfo } = require('@ckb-ccc/spore');
  const { packRawSporeData } = require('@ckb-ccc/spore/advanced');
  const { submitPassport, preparePassport, getPassport } = require('../src/lib/passport-service.ts');
  const client = new ccc.ClientPublicTestnet();
  const owner = await ccc.Address.fromKnownScript(client, ccc.KnownScript.JoyId, `0x0001${randomUUID().replaceAll('-', '').padEnd(40, '0')}`);
  const user = await prisma.user.create({ data: { githubId: `passport-${randomUUID()}`, ckbAddress: owner.toString(), ckbAddressVerifiedAt: new Date() } });
  const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: `0x${'66'.repeat(32)}`, index: 0 }, cellOutput: { lock: owner.script, capacity: ccc.fixedPointFrom(2000) }, outputData: '0x' }] });
  const sporeId = ccc.hashTypeId(tx.inputs[0], 0), content = '{"protocol":"test-fixture"}';
  tx.addOutput({ lock: owner.script, type: { ...getSporeScriptInfo(client), args: sporeId } }, packRawSporeData({ contentType: 'application/json', content: new TextEncoder().encode(content) }));
  tx.setWitnessArgs(0, { lock: '0x0000' });
  let sent = [], confirmed = false;
  client.getTransaction = async () => confirmed ? { status: 'committed', transaction: ccc.Transaction.from((await prisma.sovereignPassport.findUnique({ where: { userId: user.id } })).signedTransaction) } : undefined;
  client.sendTransactionDry = async () => 1n;
  client.sendTransaction = async value => { sent.push(ccc.hexFrom(value.toBytes())); return value.hash(); };
  try {
    await prisma.sovereignPassport.create({ data: { userId: user.id, ownerAddress: user.ckbAddress, ownerLockHash: owner.script.hash(), manifestRoot: `0x${'ab'.repeat(32)}`, manifestProof: {}, content,
      sporeId, txHash: tx.hash(), unsignedTransaction: JSON.parse(tx.stringify()), status: 'prepared' } });
    const first = tx.clone(); first.setWitnessArgs(0, { lock: '0xaaaa' });
    const second = tx.clone(); second.setWitnessArgs(0, { lock: '0xbbbb' });
    await Promise.all([submitPassport(user.githubId, first, client), submitPassport(user.githubId, second, client)]);
    assert.ok(sent.length >= 1); assert.equal(new Set(sent).size, 1);
    assert.equal(await prisma.sovereignPassport.count({ where: { userId: user.id } }), 1);
    confirmed = true;
    assert.equal((await getPassport(user.githubId, client)).passport.status, 'confirmed');
    const count = sent.length;
    await preparePassport(user.githubId, client); await submitPassport(user.githubId, second, client);
    assert.equal(sent.length, count);
  } finally {
    await prisma.sovereignPassport.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect();
  }
});
test('additive passport migration applies twice without replacing saved mint bytes', { skip: !process.env.RIVET_TEST_DATABASE_URL }, async () => {
  const { readFileSync } = require('node:fs');
  const { PrismaClient } = require('@prisma/client');
  const database = new PrismaClient({ datasources: { db: { url: process.env.RIVET_TEST_DATABASE_URL } } });
  const schema = `passport_migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await database.$transaction(async db => {
      await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await db.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await db.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
      await db.$executeRawUnsafe('INSERT INTO "User" ("id") VALUES (\'owner\')');
      const statements = readFileSync(require('node:path').join(__dirname, '../prisma/passport.sql'), 'utf8').split(';').filter(value => value.trim());
      for (const sql of statements) await db.$executeRawUnsafe(sql);
      await db.$executeRawUnsafe(`INSERT INTO "SovereignPassport" ("userId", "ownerAddress", "ownerLockHash", "manifestRoot", "manifestProof", "content", "status", "signedTransaction") VALUES ('owner', 'ckt-test', 'owner-lock', 'root', '{}', '{}', 'accepted', '{"witnesses":["0xabcd"]}')`);
      for (const sql of statements) await db.$executeRawUnsafe(sql);
      const rows = await db.$queryRawUnsafe('SELECT "signedTransaction", "buildToken", "status" FROM "SovereignPassport"');
      assert.deepEqual(rows, [{ signedTransaction: { witnesses: ['0xabcd'] }, buildToken: null, status: 'accepted' }]);
    });
  } finally { await database.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await database.$disconnect(); }
});
