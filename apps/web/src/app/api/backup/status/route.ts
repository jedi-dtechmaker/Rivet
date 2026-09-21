import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Polled by the client while a GitHub Actions backup job runs.
 * `since` is the ISO timestamp returned by POST /api/backup, so a stale
 * "already backed up" state is not mistaken for the result of this run.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repoFullName = req.nextUrl.searchParams.get('repoFullName');
    const sinceParam = req.nextUrl.searchParams.get('since');

    if (!repoFullName) {
      return NextResponse.json({ error: 'Missing repoFullName' }, { status: 400 });
    }

    const repo = await db.findRepo(repoFullName);

    if (!repo) {
      return NextResponse.json({ status: 'pending' });
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
    });
  } catch (e: any) {
    console.error('[backup/status] Error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
