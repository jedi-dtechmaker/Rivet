import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
dotenv.config({ path: [fileURLToPath(new URL('../.env.local', import.meta.url)), fileURLToPath(new URL('../.env', import.meta.url))], quiet: true });

async function main() {
  const [githubId, filename] = process.argv.slice(2);
  if (!/^[1-9][0-9]+$/.test(githubId || '') || !filename) throw new Error('Usage: check-unchanged-manifest.ts GITHUB_ID evidence.json');
  const { prisma } = await import('../src/lib/db');
  const { getManifestState, prepareManifest, exportManifestProof } = await import('../src/lib/cota-manifest-service');
  const { createTestnetClient } = await import('../src/lib/ckb-server');
  const { manifestIssuer } = await import('../src/lib/cota-manifest-config');
  const { verifyManifestProofPackage } = await import('../src/lib/cota-manifest-verify');
  const client = createTestnetClient();
  try {
    const initial = await getManifestState(githubId, client);
    if (initial.nextStep !== 'ready' || initial.hasChanges || initial.operation) throw new Error('The account has pending work or newer backups. Complete its owner-approved sync before unchanged acceptance. No transaction was prepared.');
    const user = await prisma.user.findUniqueOrThrow({ where: { githubId } });
    const proof = await exportManifestProof(githubId, client);
    const count = await prisma.cotaManifestOperation.count({ where: { userId: user.id } });
    const before = await client.getCellLiveNoCache({ txHash: proof.manifestTxHash!, index: 0 }, true);
    assert.ok(before, 'Manifest snapshot cell must still be live for this acceptance check');
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await prepareManifest(githubId, undefined, client);
      assert.equal(state.nextStep, 'ready'); assert.equal(state.hasChanges, false); assert.equal(state.operation, null);
    }
    assert.equal(await prisma.cotaManifestOperation.count({ where: { userId: user.id } }), count);
    const after = await client.getCellLiveNoCache(before.outPoint, true);
    assert.ok(after); assert.equal(after.cellOutput.capacity, before.cellOutput.capacity); assert.equal(after.outputData, before.outputData);
    const issuer = await manifestIssuer(client);
    const verified = await verifyManifestProofPackage(proof, { client, expectedIssuerLockHash: issuer.lock.hash() });
    await writeFile(filename, JSON.stringify({ check: 'unchanged-manifest-api-v1', githubId, checkedAt: new Date().toISOString(),
      attempts: 3, operationCountBefore: count, operationCountAfter: count, txHash: proof.manifestTxHash,
      capacityBefore: before.cellOutput.capacity.toString(), capacityAfter: after.cellOutput.capacity.toString(), verified,
      browserReconnect: 'pending manual JoyID acceptance; this script does not exercise a browser' }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log('Unchanged API sync passed: no new operation, transaction, or capacity deduction. Browser reconnect remains separate.');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error && /^(Usage:|The account)/.test(error.message) ? error.message : 'Unchanged acceptance could not finish. Check database/RPC access and account readiness.'); process.exitCode = 1; });
