import { readFile, stat } from 'node:fs/promises';
import { ccc } from '@ckb-ccc/core';
import { CkbHttpTransport } from '../src/lib/ckb-server';
import { verifyManifestProofPackage } from '../src/lib/cota-manifest-verify';

const usage = 'Usage: tsx scripts/verify-cota-manifest.ts --proof <proof.json> --issuer-lock-hash <trusted-0x-hash> [--rpc <CKB-testnet-RPC-URL>]';

async function main() {
  const values = new Map<string, string>();
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${usage}\n\nObtain the trusted Rivet issuer lock hash independently from the proof file. No environment file or Rivet API is used.\n`);
    return;
  }
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--proof', '--issuer-lock-hash', '--rpc'].includes(name) || !value || value.startsWith('--') || values.has(name)) throw new Error(usage);
    values.set(name, value);
  }
  const filename = values.get('--proof');
  const expectedIssuerLockHash = values.get('--issuer-lock-hash');
  if (!filename || !expectedIssuerLockHash) throw new Error(usage);
  const file = await stat(filename);
  if (!file.isFile() || file.size > 20_000) throw new Error('The manifest proof package must be a JSON file no larger than 20 KB.');
  const proof = JSON.parse(await readFile(filename, 'utf8'));
  const endpoint = values.get('--rpc') || 'https://testnet.ckb.dev/';
  const client = ccc.ClientPublicTestnet.new({ transport: new CkbHttpTransport(endpoint) });
  const result = await verifyManifestProofPackage(proof, { expectedIssuerLockHash, client });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`CoTA manifest verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
