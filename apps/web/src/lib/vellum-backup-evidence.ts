import { ccc } from '@ckb-ccc/core';
import { checkBackupAnchor } from './backup-anchor';
import { createTestnetClient } from './ckb-server';
import { prisma } from './db';
import { resolveVellumController, VellumIdentityInactiveError } from './vellum-controller';

const DECIMAL_ID = /^[1-9][0-9]{0,29}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export type RivetBackupClaimPayload = {
  github_user_id: string;
  github_repository_id: string;
  repository: string;
  snapshot_tx_hash: ccc.Hex;
  snapshot_output_index: number;
  anchor_version: 2;
  commit_count: number;
  backed_up_at: number;
};

export type VellumBackupEvidence = {
  repositoryId: string;
  userId: string;
  subjectDid: string;
  payload: RivetBackupClaimPayload;
  issuedAt: number;
};

export class VellumBackupEvidenceError extends Error {
  constructor(
    public readonly code: 'not_eligible' | 'anchor_pending' | 'anchor_invalid' | 'service_unavailable' | 'subject_changed',
    message: string,
  ) { super(message); }
}

type EvidenceRepository = NonNullable<Awaited<ReturnType<typeof repositoryForEvidence>>>;

function repositoryForEvidence(userId: string, repository: string) {
  return prisma.repository.findFirst({
    where: { userId, githubRepoId: { equals: repository, mode: 'insensitive' } },
    include: { user: { include: { vellumIdentity: true } } },
  });
}

type EvidenceDependencies = {
  findRepository: (userId: string, repository: string) => Promise<EvidenceRepository | null>;
  resolveController: typeof resolveVellumController;
};

const defaultDependencies: EvidenceDependencies = {
  findRepository: repositoryForEvidence,
  resolveController: resolveVellumController,
};

function outpoint(value: string | null, expectedHash: string) {
  const parts = value?.split(':');
  const index = parts?.length === 2 && /^(0|[1-9][0-9]*)$/.test(parts[1]) ? Number(parts[1]) : NaN;
  if (!parts || parts.length !== 2 || parts[0].toLowerCase() !== expectedHash.toLowerCase()
    || !Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) {
    throw new VellumBackupEvidenceError('anchor_invalid', 'The saved backup outpoint is invalid.');
  }
  return index;
}

export async function findVellumBackupEvidence(
  userId: string,
  repository: string,
  minimumConfirmations: number,
  client: ccc.Client = createTestnetClient(),
  dependencies: EvidenceDependencies = defaultDependencies,
): Promise<VellumBackupEvidence> {
  const saved = await dependencies.findRepository(userId, repository);
  if (!saved || !saved.isBackedUp || saved.isPrivate || !saved.user.vellumIdentity?.isPublic) {
    throw new VellumBackupEvidenceError('not_eligible', 'A public backup and public Vellum identity are required.');
  }
  const binding = saved.user.vellumIdentity;
  let controller;
  try { controller = await dependencies.resolveController(binding.did); }
  catch (error) {
    if (error instanceof VellumIdentityInactiveError) {
      throw new VellumBackupEvidenceError('subject_changed', 'The linked identity is no longer active. Verify an active identity before claim issuance.');
    }
    throw new VellumBackupEvidenceError('service_unavailable', 'The Vellum identity could not be resolved.');
  }
  if (controller.did !== binding.did || controller.lock.hash() !== binding.controllerLockHash) {
    throw new VellumBackupEvidenceError('subject_changed', 'The linked identity controller changed. Verify it again before claim issuance.');
  }
  if (!saved.ckbTxHash || !/^0x[0-9a-f]{64}$/i.test(saved.ckbTxHash) || !saved.lastBackupCid
    || !DECIMAL_ID.test(saved.user.githubId) || !saved.githubNumericId || !DECIMAL_ID.test(saved.githubNumericId)
    || !REPOSITORY_NAME.test(saved.fullName) || !Number.isSafeInteger(saved.commitCount)
    || saved.commitCount < 1 || saved.commitCount > 0xffffffff) {
    throw new VellumBackupEvidenceError('anchor_invalid', 'The backup metadata is incomplete or invalid.');
  }
  const outputIndex = outpoint(saved.ckbCellOutpoint, saved.ckbTxHash);
  let observed;
  try { observed = await client.getTransactionNoCache(saved.ckbTxHash); }
  catch { throw new VellumBackupEvidenceError('service_unavailable', 'The backup transaction could not be checked.'); }
  if (!observed || ['pending', 'proposed'].includes(observed.status)) {
    throw new VellumBackupEvidenceError('anchor_pending', 'The backup anchor is awaiting confirmation.');
  }
  if (observed.status !== 'committed' || observed.transaction.hash().toLowerCase() !== saved.ckbTxHash.toLowerCase()
    || !observed.transaction.outputs[outputIndex]) {
    throw new VellumBackupEvidenceError('anchor_invalid', 'The backup anchor transaction is not valid.');
  }
  let anchor;
  try { anchor = checkBackupAnchor(observed.transaction.outputsData[outputIndex], { ipfsCid: saved.lastBackupCid, commitCount: saved.commitCount }); }
  catch { throw new VellumBackupEvidenceError('anchor_invalid', 'The on-chain anchor differs from the saved backup.'); }
  if (anchor.version !== 2) throw new VellumBackupEvidenceError('anchor_invalid', 'Only version 2 backup anchors can receive claims.');
  if (!observed.blockHash) throw new VellumBackupEvidenceError('service_unavailable', 'The committed backup block is unavailable.');
  let block;
  let tip;
  try { [block, tip] = await Promise.all([client.getHeaderByHash(observed.blockHash), client.getTipHeader()]); }
  catch { throw new VellumBackupEvidenceError('service_unavailable', 'The backup confirmation depth could not be checked.'); }
  if (!block) throw new VellumBackupEvidenceError('service_unavailable', 'The committed backup block is unavailable.');
  const confirmations = tip.number >= block.number ? tip.number - block.number + 1n : 0n;
  if (confirmations < BigInt(minimumConfirmations)) {
    throw new VellumBackupEvidenceError('anchor_pending', 'The backup anchor needs more confirmations.');
  }
  const timestampMs = Number(block.timestamp);
  const backedUpAt = Math.floor(timestampMs / 1_000);
  if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0 || !Number.isSafeInteger(backedUpAt) || backedUpAt <= 0) {
    throw new VellumBackupEvidenceError('anchor_invalid', 'The backup block timestamp is invalid.');
  }
  return {
    repositoryId: saved.id,
    userId: saved.userId,
    subjectDid: binding.did,
    issuedAt: backedUpAt,
    payload: {
      github_user_id: saved.user.githubId,
      github_repository_id: saved.githubNumericId,
      repository: saved.fullName,
      snapshot_tx_hash: saved.ckbTxHash.toLowerCase() as ccc.Hex,
      snapshot_output_index: outputIndex,
      anchor_version: 2,
      commit_count: saved.commitCount,
      backed_up_at: backedUpAt,
    },
  };
}
