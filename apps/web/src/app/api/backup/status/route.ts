import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { backupProgress } from '@/lib/backup-progress';
import { db, prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Account-only progress for a backup job. Worker details and keys stay private.
 * `since` is the ISO timestamp returned by POST /api/backup, so a stale
 * "already backed up" state is not mistaken for the result of this run.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repoFullName = req.nextUrl.searchParams.get('repoFullName');
    const sinceParam = req.nextUrl.searchParams.get('since');
    const jobId = req.nextUrl.searchParams.get('jobId');

    if (!repoFullName) {
      return NextResponse.json({ error: 'Missing repoFullName' }, { status: 400 });
    }

    const repo = await db.findRepo(repoFullName);

    const user = await db.findUserByGithubId(session.user.id);
    if (!repo || !user || repo.userId !== user.id) {
      return NextResponse.json({ status: 'pending' }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (jobId) {
      const job = await prisma.workerDispatch.findFirst({ where: {
        id: jobId, userId: user.id, repository: repoFullName.toLowerCase(), kind: 'backup',
      }, select: { state: true, progress: true, checkpoint: true } });
      if (!job) return NextResponse.json({ error: 'Backup job not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
      const checkpoint = job.checkpoint as { txHash?: string } | null;
      const done = job.state === 'completed' || job.state === 'unchanged';
      return NextResponse.json({
        status: done ? 'done' : job.state === 'failed' ? 'failed' : 'pending',
        ...backupProgress(job.state, job.progress),
        ...(done ? { ckbTxHash: checkpoint?.txHash ?? repo.ckbTxHash } : {}),
        ...(job.state === 'unchanged' ? { unchanged: true } : {}),
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const since = sinceParam ? new Date(sinceParam) : null;
    const updatedSinceDispatch = since ? new Date(repo.updatedAt) > since : false;
    const done = Boolean(repo.isBackedUp) && updatedSinceDispatch;

    return NextResponse.json({
      status: done ? 'done' : 'pending',
      isBackedUp: repo.isBackedUp,
      ckbTxHash: repo.ckbTxHash,
      lastBackupCid: repo.lastBackupCid,
      commitsProcessed: repo.commitCount,
      updatedAt: repo.updatedAt,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('[backup/status] Error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
