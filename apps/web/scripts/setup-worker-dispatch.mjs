import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: [fileURLToPath(new URL('../.env.local', import.meta.url)), fileURLToPath(new URL('../.env', import.meta.url))], quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL first.');
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  const client = new PrismaClient();
  try {
    const sql = await readFile(new URL('../prisma/worker-dispatch.sql', import.meta.url), 'utf8');
    await client.$transaction(async transaction => {
      await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await transaction.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
      await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
      await transaction.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(7824102)');
      for (const statement of sql.split(';').filter(value => value.trim())) await transaction.$executeRawUnsafe(statement);
      await transaction.$queryRawUnsafe('SELECT "id", "userId", "kind", "createdAt" FROM "WorkerDispatch" LIMIT 0');
    }, { maxWait: 15000, timeout: 45000 });
    console.log('Worker dispatch limits are ready. Existing backups and identities are preserved.');
  } finally { await client.$disconnect(); }
}

main().catch(error => {
  console.error(error.code ? `Worker setup failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
