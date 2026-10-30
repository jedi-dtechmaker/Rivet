import { NextResponse } from 'next/server';
import { cliAccount } from '@/lib/cli-auth';
import { prisma } from '@/lib/db';
import { createTestnetClient } from '@/lib/ckb-server';
export async function GET(request: Request) {
  try {
    const account = await cliAccount(request);
    if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(request.url), name = url.searchParams.get('repo');
    const repo = await prisma.repository.findFirst({ where: { userId: account.user.id, githubRepoId: name || '', isPrivate: false } });
    if (!repo) return NextResponse.json({ error: 'Public backup not found for this account.' }, { status: 404 });
    const since = url.searchParams.get('since');
    if (since && !Number.isFinite(Date.parse(since))) return NextResponse.json({ error: 'Invalid dispatch time.' }, { status: 400 });
    if (since && repo.updatedAt.getTime() <= Date.parse(since)) return NextResponse.json({ status: 'pending' });
    if (!repo.ckbTxHash || !repo.ckbCellOutpoint || !repo.lastBackupCid || !repo.isBackedUp) return NextResponse.json({ status: 'pending' });
    const client = createTestnetClient(), tx = await client.getTransaction(repo.ckbTxHash);
    if (tx?.status !== 'committed') return NextResponse.json({ status: 'pending', txHash: repo.ckbTxHash });
    const [hash, rawIndex] = repo.ckbCellOutpoint.split(':');
    const index = Number(rawIndex);
    if (hash !== repo.ckbTxHash || !Number.isSafeInteger(index) || index < 0 || !/^0x[0-9a-f]{64}$/i.test(tx.transaction.outputsData[index] || '')) throw new Error('Invalid anchor');
    const header = tx.blockHash ? await client.getHeaderByHash(tx.blockHash) : undefined;
    return NextResponse.json({ status: 'confirmed', proof: {
      protocol: 'rivet-backup-proof-v1', network: 'ckb-testnet', repository: repo.fullName,
      txHash: repo.ckbTxHash, outputIndex: index, ipfsCid: repo.lastBackupCid, merkleRoot: tx.transaction.outputsData[index],
      commitCount: repo.commitCount, blockHeight: header?.number.toString() || null,
      ...(url.searchParams.get('includeSecrets') === 'true' ? { encryptionKey: repo.encryptionKey, encryptionIv: repo.encryptionIv } : {}),
    } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not check backup status.' }, { status: 503 }); }
}
