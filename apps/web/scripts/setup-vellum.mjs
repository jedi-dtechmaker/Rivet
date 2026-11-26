import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: [fileURLToPath(new URL('../.env.local', import.meta.url)), fileURLToPath(new URL('../.env', import.meta.url))], quiet: true });

const expected = {
  VellumDidChallenge: ['id', 'userId', 'did', 'controllerLockHash', 'message', 'expiresAt', 'createdAt'],
  VellumIdentityBinding: ['userId', 'did', 'controllerLockHash', 'isPublic', 'verifiedAt', 'createdAt', 'updatedAt'],
  VellumBackupClaim: ['repositoryId', 'userId', 'subjectDid', 'issuerDid', 'schemaHash', 'nonce', 'payload', 'issuedAt', 'status', 'leaseToken', 'claimId', 'outputIndex', 'signedTransaction', 'transactionHash', 'confirmedAt', 'lastErrorCode', 'revision', 'createdAt', 'updatedAt'],
  VellumIssuerLease: ['key', 'token', 'repositoryId', 'transactionHash', 'expiresAt', 'revision', 'createdAt', 'updatedAt'],
};

async function inspect(client, schema) {
  const rows = await client.$queryRawUnsafe(
    'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[])',
    schema, Object.keys(expected),
  );
  const present = new Set(rows.map(row => `${row.table_name}.${row.column_name}`));
  if (!present.has('VellumDidChallenge.id') && rows.length > 0) {
    throw new Error('The Vellum schema is partially installed. Inspect it before applying another upgrade.');
  }
  return {
    complete: Object.entries(expected).every(([table, columns]) => columns.every(column => present.has(`${table}.${column}`))),
    empty: rows.length === 0,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL in apps/web/.env first.');
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  const client = new PrismaClient();
  try {
    const installed = await client.$transaction(async transaction => {
      await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await transaction.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
      await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
      await transaction.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(7824110)');
      const before = await inspect(transaction, schema);
      if (before.complete) return false;
      if (!before.empty) throw new Error('The Vellum schema is partially installed. Inspect it before applying another upgrade.');
      const sql = await readFile(new URL('../prisma/vellum-integration.sql', import.meta.url), 'utf8');
      for (const statement of sql.split(';').filter(value => value.trim())) await transaction.$executeRawUnsafe(statement);
      if (!(await inspect(transaction, schema)).complete) throw new Error('Vellum schema verification failed.');
      return true;
    }, { maxWait: 15000, timeout: 45000 });
    console.log(installed ? 'Vellum identity and claim schema installed.' : 'Vellum schema is already installed. No changes made.');
  } finally {
    await client.$disconnect();
  }
}

main().catch(error => {
  console.error(error.code ? `Database setup failed (${error.code}). Check database connectivity and permissions.` : error.message);
  process.exitCode = 1;
});
