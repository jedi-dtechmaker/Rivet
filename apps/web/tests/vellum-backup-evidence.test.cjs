const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { argsToDid } = require('@ckb-ccc/did-ckb');
const { findVellumBackupEvidence } = require('../src/lib/vellum-backup-evidence.ts');
const { backupFixture } = require('./fixtures/backup-job.cjs');

function setup(overrides = {}) {
  const fixture = backupFixture();
  const controllerLock = ccc.Script.from({ codeHash: `0x${'88'.repeat(32)}`, hashType: 'type', args: `0x${'99'.repeat(20)}` });
  const did = argsToDid(`0x${'77'.repeat(20)}`);
  const repository = {
    id: 'repository-id', userId: 'user-id', githubRepoId: 'owner/project', githubNumericId: '2002', fullName: 'Owner/project',
    isBackedUp: true, isPrivate: false, commitCount: 2, ckbTxHash: fixture.saved.txHash,
    ckbCellOutpoint: fixture.saved.result.ckbCellOutpoint, lastBackupCid: fixture.saved.result.ipfsCid,
    user: { githubId: '1001', vellumIdentity: { did, controllerLockHash: controllerLock.hash(), isPublic: true } },
    ...overrides,
  };
  const client = {
    getTransactionNoCache: async () => ({ status: 'committed', transaction: fixture.transaction, blockHash: `0x${'55'.repeat(32)}` }),
    getHeaderByHash: async () => ({ number: 100n, timestamp: 2_000_000_000_000n }),
    getTipHeader: async () => ({ number: 105n }),
  };
  const dependencies = { findRepository: async () => repository,
    resolveController: async () => ({ did, lock: controllerLock, document: {}, client }) };
  return { client, dependencies, fixture, repository, did };
}

test('eligible evidence binds stable GitHub IDs to a confirmed public v2 anchor', async () => {
  const value = setup();
  const evidence = await findVellumBackupEvidence('user-id', 'owner/project', 6, value.client, value.dependencies);
  assert.equal(evidence.repositoryId, 'repository-id');
  assert.equal(evidence.subjectDid, value.did);
  assert.deepEqual(evidence.payload, {
    github_user_id: '1001', github_repository_id: '2002', repository: 'Owner/project',
    snapshot_tx_hash: value.fixture.saved.txHash, snapshot_output_index: 0, anchor_version: 2,
    commit_count: 2, backed_up_at: 2_000_000_000,
  });
  assert.equal(evidence.issuedAt, 2_000_000_000);
});

test('private backups and private identity bindings are never claim candidates', async () => {
  for (const repository of [setup({ isPrivate: true }), setup({ user: { githubId: '1001', vellumIdentity: null } }),
    setup({ user: { githubId: '1001', vellumIdentity: { ...setup().repository.user.vellumIdentity, isPublic: false } } })]) {
    await assert.rejects(findVellumBackupEvidence('user-id', 'owner/project', 1, repository.client, repository.dependencies), error => error.code === 'not_eligible');
  }
});

test('controller rotation, insufficient confirmations, and malformed provenance fail closed', async () => {
  const rotated = setup();
  rotated.repository.user.vellumIdentity.controllerLockHash = `0x${'00'.repeat(32)}`;
  await assert.rejects(findVellumBackupEvidence('user-id', 'owner/project', 1, rotated.client, rotated.dependencies), error => error.code === 'subject_changed');

  const mismatchedIdentity = setup();
  const mismatchedController = await mismatchedIdentity.dependencies.resolveController();
  mismatchedIdentity.dependencies.resolveController = async () => ({ ...mismatchedController, did: argsToDid(`0x${'12'.repeat(20)}`) });
  await assert.rejects(findVellumBackupEvidence('user-id', 'owner/project', 1,
    mismatchedIdentity.client, mismatchedIdentity.dependencies), error => error.code === 'subject_changed');

  const pending = setup();
  pending.client.getTipHeader = async () => ({ number: 103n });
  await assert.rejects(findVellumBackupEvidence('user-id', 'owner/project', 6, pending.client, pending.dependencies), error => error.code === 'anchor_pending');

  const malformed = setup({ githubNumericId: null });
  await assert.rejects(findVellumBackupEvidence('user-id', 'owner/project', 1, malformed.client, malformed.dependencies), error => error.code === 'anchor_invalid');

  const oversizedIndex = setup();
  oversizedIndex.repository.ckbCellOutpoint = `${oversizedIndex.repository.ckbTxHash}:4294967296`;
  await assert.rejects(findVellumBackupEvidence('user-id', 'owner/project', 1, oversizedIndex.client, oversizedIndex.dependencies), error => error.code === 'anchor_invalid');
});
