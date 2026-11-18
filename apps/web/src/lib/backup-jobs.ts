import { ccc } from '@ckb-ccc/core';
import { prisma } from '@/lib/db';
import { parseBackupAnchor } from '@/lib/backup-anchor';
import { createTestnetClient } from '@/lib/ckb-server';

export type BackupCheckpoint = {
  signedTransaction: string;
  txHash: string;
  result: {
    merkleRoot: string; ipfsCid: string; ckbTxHash: string; ckbCellOutpoint: string;
    commitsProcessed: number; encryptionKey: string; encryptionIv: string;
    githubNumericId?: string; reusedCell: boolean;
  };
};

function checkpoint(value: unknown, previousOutpoint: string | null): BackupCheckpoint {
  const saved = value as BackupCheckpoint;
  if (typeof saved?.signedTransaction !== 'string' || !/^0x[0-9a-f]+$/i.test(saved.signedTransaction) || saved.signedTransaction.length > 2000000) throw new Error('Invalid saved backup transaction.');
  const tx = ccc.Transaction.fromBytes(saved.signedTransaction);
  const anchor = parseBackupAnchor(tx.outputsData[0]);
  const result = saved.result;
  if (anchor.version !== 2 || saved.txHash !== tx.hash() || result?.ckbTxHash !== saved.txHash
    || result.ckbCellOutpoint !== `${saved.txHash}:0` || anchor.merkleRoot !== result.merkleRoot
    || anchor.ipfsCid !== result.ipfsCid || anchor.commitCount !== result.commitsProcessed
    || !/^[a-f0-9]{64}$/i.test(result.encryptionKey) || !/^[a-f0-9]{24}$/i.test(result.encryptionIv)
    || (result.githubNumericId !== undefined && !/^[1-9][0-9]{0,29}$/.test(result.githubNumericId))
    || (previousOutpoint && !tx.inputs.some(input => `${input.previousOutput.txHash}:${input.previousOutput.index}` === previousOutpoint))
    || result.reusedCell !== Boolean(previousOutpoint)) throw new Error('Backup checkpoint differs from its anchor or predecessor.');
  return saved;
}

export async function prepareBackupJob(id: string, repository: string, value: unknown) {
  return prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824103)`;
    const job = await transaction.workerDispatch.findUniqueOrThrow({ where: { id } });
    if (job.kind !== 'backup' || job.repository !== repository.toLowerCase() || !['queued', 'prepared', 'completed'].includes(job.state)) throw new Error('Backup job is not active for this repository.');
    if (job.checkpoint) return job.checkpoint as unknown as BackupCheckpoint;
    const saved = checkpoint(value, job.previousOutpoint);
    await transaction.workerDispatch.update({ where: { id }, data: { state: 'prepared', checkpoint: JSON.parse(JSON.stringify(saved)) } });
    return saved;
  });
}

export async function completeBackupJob(id: string, repository: string, txHash: string,
  verify: (saved: BackupCheckpoint) => Promise<void> = verifyCommittedCheckpoint) {
  const initial = await prisma.workerDispatch.findUniqueOrThrow({ where: { id } });
  if (initial.kind !== 'backup' || initial.repository !== repository.toLowerCase() || !initial.checkpoint) throw new Error('Backup has no saved signed transaction.');
  const saved = checkpoint(initial.checkpoint, initial.previousOutpoint);
  if (saved.txHash !== txHash) throw new Error('Backup callback differs from its saved transaction.');
  await verify(saved);
  return prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824103)`;
    const job = await transaction.workerDispatch.findUniqueOrThrow({ where: { id } });
    if (job.state === 'completed') return { job, result: saved.result, replayed: true };
    if (job.state !== 'prepared') throw new Error('Backup job is not prepared.');
    const result = saved.result;
    const changed = await transaction.repository.updateMany({ where: { githubRepoId: { equals: repository, mode: 'insensitive' }, userId: job.userId,
      ckbCellOutpoint: job.previousOutpoint }, data: { isBackedUp: true, lastBackupCid: result.ipfsCid,
      ckbTxHash: result.ckbTxHash, ckbCellOutpoint: result.ckbCellOutpoint, encryptionKey: result.encryptionKey,
      encryptionIv: result.encryptionIv, commitCount: result.commitsProcessed,
      ...(result.githubNumericId ? { githubNumericId: result.githubNumericId } : {}) } });
    if (changed.count !== 1) throw new Error('Backup predecessor advanced. Reconcile the saved job before updating the repository.');
    await transaction.workerDispatch.update({ where: { id }, data: { state: 'completed' } });
    return { job, result, replayed: false };
  });
}

async function verifyCommittedCheckpoint(saved: BackupCheckpoint) {
  const client = createTestnetClient();
  const result = await client.getTransactionNoCache(saved.txHash);
  if (result?.status !== 'committed' || result.transaction.toHex() !== saved.signedTransaction) throw new Error('Backup transaction is not confirmed with its saved bytes.');
}
