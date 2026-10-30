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
    const sql = await readFile(new URL('../prisma/cota-manifest.sql', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../prisma/passport.sql', import.meta.url), 'utf8');
    await client.$transaction(async transaction => {
      await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await transaction.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
      await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
      await transaction.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(7824104)');
      for (const statement of sql.split(';').filter(value => value.trim())) {
        await transaction.$executeRawUnsafe(statement);
      }
      await transaction.$queryRawUnsafe('SELECT "id", "githubNumericId" FROM "Repository" LIMIT 0');
      await transaction.$queryRawUnsafe('SELECT "id", "network", "cotaScriptHash", "revision", "reservationId", "reservedUntil" FROM "PublicationStream" LIMIT 0');
      await transaction.$queryRawUnsafe('SELECT "id", "streamId", "snapshot", "planDigest", "acceptedAttemptId", "confirmedTransaction" FROM "CotaManifestOperation" LIMIT 0');
      await transaction.$queryRawUnsafe('SELECT "id", "operationId", "digest", "serializedTransaction", "preflight", "firstBroadcastAt" FROM "CotaManifestSignedAttempt" LIMIT 0');
      await transaction.$queryRawUnsafe('SELECT "userId", "ownerLockHash", "issuerLockHash", "collectionId", "tokenIndexes", "issuanceOperationId", "initialManifest", "claimTxHash" FROM "CotaManifestEnrollment" LIMIT 0');
    }, { maxWait: 10000, timeout: 45000 });
    console.log('CoTA manifest publication storage is ready. No on-chain operation was performed.');
  } finally { await client.$disconnect(); }
}

main().catch(error => {
  console.error(error.code ? `CoTA manifest setup failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
