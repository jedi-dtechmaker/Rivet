import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: [fileURLToPath(new URL('../.env.local', import.meta.url)), fileURLToPath(new URL('../.env', import.meta.url))], quiet: true });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL first.');
  const { PrismaClient } = await import('@prisma/client');
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  const client = new PrismaClient();
  try {
    const sql = await readFile(new URL('../prisma/analytics.sql', import.meta.url), 'utf8');
    await client.$transaction(async transaction => {
      await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
      await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7824111)::text');
      for (const statement of sql.split(';').filter(value => value.trim())) await transaction.$executeRawUnsafe(statement);
    });
    console.log('Analytics tables are ready. Set RIVET_ANALYTICS_ENABLED=true to begin recording.');
  } finally {
    await client.$disconnect();
  }
}

main().catch(() => {
  console.error('Analytics setup failed. Check the database connection, permissions, and existing schema.');
  process.exitCode = 1;
});
