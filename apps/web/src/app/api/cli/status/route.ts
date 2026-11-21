import { NextResponse } from 'next/server';
import { cliAccount } from '@/lib/cli-auth';
import { prisma } from '@/lib/db';
import { createTestnetClient } from '@/lib/ckb-server';
import { checkBackupAnchor } from '@/lib/backup-anchor';
import type { BackupCheckpoint, UnchangedBackupCheckpoint } from '@/lib/backup-jobs';
export async function GET(request: Request) {
  try {
    const account = await cliAccount(request);
    if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url), name = url.searchParams.get('repo');
    let repo = await prisma.repository.findFirst({ where: { userId: account.user.id, githubRepoId: name || '', isPrivate: false } });
    if (!repo) return NextResponse.json({ error: 'Public backup not found for this account.' }, { status: 404 });
    const since = url.searchParams.get('since');
    if (since && !Number.isFinite(Date.parse(since))) return NextResponse.json({ error: 'Invalid dispatch time.' }, { status: 400 });
    const jobId = url.searchParams.get('jobId');
    let unchanged = false;
    if (jobId) {
      const job = await prisma.workerDispatch.findFirst({ where: { id: jobId, userId: account.user.id, repository: name!.toLowerCase(), kind: 'backup' } });
      if (!job) return NextResponse.json({ error: 'Backup job not found.' }, { status: 404 });
      if (job.state === 'failed') return NextResponse.json({ status: 'failed' });
      if (!['completed', 'unchanged'].includes(job.state)) return NextResponse.json({ status: 'pending' });
      const saved = job.checkpoint as unknown as BackupCheckpoint | UnchangedBackupCheckpoint;
      if (!saved?.result || saved.txHash !== saved.result.ckbTxHash) throw new Error('Invalid backup checkpoint');
      repo = { ...repo, isBackedUp: true, ckbTxHash: saved.txHash, ckbCellOutpoint: saved.result.ckbCellOutpoint,
        lastBackupCid: saved.result.ipfsCid, commitCount: saved.result.commitsProcessed,
        encryptionKey: saved.result.encryptionKey, encryptionIv: saved.result.encryptionIv };
      unchanged = job.state === 'unchanged';
    } else if (since && repo.updatedAt.getTime() <= Date.parse(since)) return NextResponse.json({ status: 'pending' });
    if (!repo.ckbTxHash || !repo.ckbCellOutpoint || !repo.lastBackupCid || !repo.isBackedUp) return NextResponse.json({ status: 'pending' });
    const client = createTestnetClient(), tx = await client.getTransaction(repo.ckbTxHash);
    if (tx?.status !== 'committed') return NextResponse.json({ status: 'pending', txHash: repo.ckbTxHash });
    const [hash, rawIndex] = repo.ckbCellOutpoint.split(':');
    const index = Number(rawIndex);
    if (hash !== repo.ckbTxHash || !Number.isSafeInteger(index) || index < 0 || !tx.transaction.outputs[index]
      || tx.transaction.hash() !== repo.ckbTxHash) throw new Error('Invalid anchor');
    const anchor = checkBackupAnchor(tx.transaction.outputsData[index], { ipfsCid: repo.lastBackupCid, commitCount: repo.commitCount });
    const header = tx.blockHash ? await client.getHeaderByHash(tx.blockHash) : undefined;
    return NextResponse.json({ status: 'confirmed', ...(unchanged ? { unchanged: true } : {}), proof: {
      protocol: `rivet-backup-proof-v${anchor.version}`, network: 'ckb-testnet', repository: repo.fullName,
      txHash: repo.ckbTxHash, outputIndex: index, ipfsCid: repo.lastBackupCid, merkleRoot: anchor.merkleRoot,
      ...(anchor.version === 2 ? { refsHash: anchor.refsHash, bundleSha256: anchor.bundleSha256 } : {}),
      commitCount: repo.commitCount, blockHeight: header?.number.toString() || null,
      ...(url.searchParams.get('includeSecrets') === 'true' ? { encryptionKey: repo.encryptionKey, encryptionIv: repo.encryptionIv } : {}),
    } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not check backup status.' }, { status: 503 }); }
}
