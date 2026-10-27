const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');

test('unchanged confirmed manifests survive JSONB field reordering without requesting another update', async () => {
  const previousPrisma = globalThis.prisma;
  const names = ['COTA_MANIFEST_ENABLED', 'COTA_MANIFEST_ISSUER_PRIVATE_KEY', 'COTA_MANIFEST_COLLECTION_ID'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.COTA_MANIFEST_ENABLED = 'true';
  process.env.COTA_MANIFEST_ISSUER_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
  process.env.COTA_MANIFEST_COLLECTION_ID = `0x${'22'.repeat(20)}`;
  try {
    const client = new ccc.ClientPublicTestnet();
    const signer = new ccc.SignerCkbPrivateKey(client, process.env.COTA_MANIFEST_ISSUER_PRIVATE_KEY);
    const issuer = (await signer.getRecommendedAddressObj()).script;
    const user = { id: 'user', githubId: '1001', githubUsername: 'developer', ckbAddress: 'saved-verified-owner', ckbAddressVerifiedAt: new Date() };
    const repo = { id: 'repo', githubNumericId: '2001', fullName: 'developer/repo', lastBackupCid: 'bafy-public',
      ckbCellOutpoint: `0x${'33'.repeat(32)}:0`, ckbTxHash: `0x${'33'.repeat(32)}`, commitCount: 1 };
    // PostgreSQL JSONB emits nested object properties in a different order.
    const persistedSnapshot = { repositories: [{ commits: 1, txHash: repo.ckbTxHash, anchor: repo.ckbCellOutpoint,
      cid: repo.lastBackupCid, name: repo.fullName, numericId: repo.githubNumericId, id: repo.id }], username: 'developer', owner: user.ckbAddress };
    const confirmed = { id: 'confirmed', kind: 'update', status: 'confirmed', root: `0x${'44'.repeat(32)}`, txHash: `0x${'55'.repeat(32)}`,
      plan: { recordSnapshot: persistedSnapshot, envelope: { records: [{ record: { kind: 'backup' } }] } } };
    globalThis.prisma = {
      user: { findUnique: async () => user },
      cotaRegistration: { findUnique: async () => ({ status: 'confirmed', address: user.ckbAddress }) },
      cotaManifestEnrollment: { findUnique: async () => ({ status: 'claimed', issuerLockHash: issuer.hash(), collectionId: process.env.COTA_MANIFEST_COLLECTION_ID }) },
      cotaManifestOperation: { findFirst: async query => query.where.kind ? confirmed : null },
      repository: { findMany: async () => [repo] },
    };
    const { getManifestState } = require('../src/lib/cota-manifest-service.ts');
    const state = await getManifestState(user.githubId, client);
    assert.equal(state.nextStep, 'ready');
    assert.equal(state.hasChanges, false);
    assert.equal(state.operation, null);
    // New backup contents still require approval even when the object keys match.
    repo.lastBackupCid = 'bafy-new-public';
    const changed = await getManifestState(user.githubId, client);
    assert.equal(changed.nextStep, 'update');
    assert.equal(changed.hasChanges, true);
  } finally {
    if (previousPrisma === undefined) delete globalThis.prisma; else globalThis.prisma = previousPrisma;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
});
