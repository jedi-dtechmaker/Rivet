import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import dotenv from 'dotenv';

function webDirectory() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'prisma', 'schema.prisma'))) return cwd;
  const nested = join(cwd, 'apps', 'web');
  if (existsSync(join(nested, 'prisma', 'schema.prisma'))) return nested;
  throw new Error('Run the issuer command from the repository root or apps/web.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log('Usage: cota:issuer create | prepare | status [--id ID] | submit --id ID');
    console.log('Only submit broadcasts a saved transaction. prepare builds and saves it for review.');
    return;
  }
  if (!['create', 'prepare', 'status', 'submit'].includes(command)) throw new Error('Unknown issuer command. Use --help.');
  let id: string | undefined;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--id' || !args[1] || !['status', 'submit'].includes(command)) throw new Error('Expected status [--id ID] or submit --id ID.');
    id = args[1];
  }
  if (command === 'submit' && !id) throw new Error('submit requires the reviewed operation ID: submit --id ID.');
  const directory = webDirectory();
  const secretFile = resolve(directory, '.env.cota-manifest-issuer.local');
  dotenv.config({ path: [join(directory, '.env.local'), join(directory, '.env'), secretFile, join(directory, '.env.cota-sponsor.local')], quiet: true });
  // Environment is loaded before importing modules that initialize Prisma.
  const issuer = await import('../src/lib/cota-manifest-issuer');
  if (command === 'create') {
    const created = await issuer.createManifestIssuerKeyFile(secretFile);
    console.log(`Testnet manifest issuer: ${created.address}`);
    console.log(`Private key saved in ${created.filename} with owner access only.`);
    return;
  }
  const { prisma } = await import('../src/lib/db');
  try {
    const result = command === 'prepare' ? await issuer.prepareManifestIssuerSetup()
      : command === 'submit' ? await issuer.submitManifestIssuerSetup(id!) : await issuer.manifestIssuerSetupStatus(id);
    console.log(`Testnet manifest issuer: ${result.address}`);
    console.log(`Stage: ${result.stage}`);
    if (result.operation) {
      console.log(`Operation: ${result.operation.id} (${result.operation.kind})`);
      if (result.operation.feeCKB !== null) console.log(`Fee: ${result.operation.feeCKB} CKB`);
      if (result.operation.txHash) console.log(`Transaction: ${result.operation.txHash}`);
      if (result.stage === 'awaiting_signature' || result.stage === 'signed_ready') console.log(`Review, then submit --id ${result.operation.id}`);
    }
    if (typeof result.collectionId === 'string') {
      console.log(`Collection: ${result.collectionId}`);
      if (result.stage === 'confirmed') console.log(`Pin COTA_MANIFEST_COLLECTION_ID=${result.collectionId} in the application configuration.`);
    }
    if (result.operation?.kind === 'issuer-register' && result.stage === 'confirmed') console.log('Run prepare again to define the manifest collection.');
  } finally { await prisma.$disconnect(); }
}

main().catch(error => {
  // Provider errors occasionally include supplied values. Never echo a key.
  let message = error instanceof Error ? error.message : 'Issuer setup failed.';
  for (const key of [process.env.COTA_MANIFEST_ISSUER_PRIVATE_KEY, process.env.COTA_SPONSOR_PRIVATE_KEY]) {
    if (key && key.length > 8) message = message.replaceAll(key, '[redacted]').replaceAll(key.replace(/^0x/, ''), '[redacted]');
  }
  console.error(message);
  process.exitCode = 1;
});
