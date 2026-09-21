import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { dispatchBackup, isValidRepoFullName } from '@/lib/backupDispatch';

/**
 * Starts a backup job. Returns immediately (202) with a job id; the heavy work
 * runs on GitHub Actions and reports back to /api/backup/callback.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const repoFullName = body?.repoFullName;

    if (!isValidRepoFullName(repoFullName)) {
      return NextResponse.json({ error: 'Invalid repoFullName' }, { status: 400 });
    }

    // If this repo already has an anchor cell, hand its outpoint to the worker so
    // it spends and rewrites that cell rather than creating a new one.
    const existing = await db.findRepo(repoFullName);
    const previousOutpoint = existing?.ckbCellOutpoint ?? undefined;

    // The user's OAuth token already has `repo` scope, so it can dispatch the
    // workflow on their own repository without a separate PAT.
    const result = await dispatchBackup(
      repoFullName,
      session.accessToken,
      previousOutpoint,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      {
        accepted: true,
        jobId: result.jobId,
        repoFullName,
        runUrl: result.runUrl,
        startedAt: result.startedAt,
      },
      { status: 202 },
    );
  } catch (error: any) {
    console.error('[backup] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
