import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db, prisma } from '@/lib/db';
import { dispatchBackup, isValidRepoFullName } from '@/lib/backupDispatch';
import { PRIVATE_BACKUP_MESSAGE, readPublicRepository } from '@/lib/public-repository';
import { walletRequestOrigin } from '@/lib/wallet-request';

/**
 * Starts a backup job. Returns immediately (202) with a job id; the heavy work
 * runs on GitHub Actions and reports back to /api/backup/callback.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try { walletRequestOrigin(req); }
    catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }

    const body = await req.json().catch(() => ({}));
    const repoFullName = body?.repoFullName;

    if (!isValidRepoFullName(repoFullName)) {
      return NextResponse.json({ error: 'Invalid repoFullName' }, { status: 400 });
    }
    if (body.isPrivate === true) return NextResponse.json({ error: PRIVATE_BACKUP_MESSAGE }, { status: 403 });

    const user = await db.findUserByGithubId(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'Account not found. Sign in again.' }, { status: 404 });
    }
    const access = await readPublicRepository(repoFullName, session.accessToken);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const githubRepo = access.repository;
    const githubNumericId = Number.isSafeInteger(githubRepo.id) && githubRepo.id! > 0 ? String(githubRepo.id) : undefined;
    if (String(githubRepo.owner?.id) !== session.user.id && !githubRepo.permissions?.push && !githubRepo.permissions?.admin) {
      return NextResponse.json({ error: 'Choose a repository you own or have write access to.' }, { status: 403 });
    }

    const existing = await prisma.repository.upsert({
      where: { githubRepoId: repoFullName },
      update: {},
      create: {
        githubRepoId: repoFullName,
        ...(githubNumericId ? { githubNumericId } : {}),
        fullName: repoFullName,
        name: repoFullName.split('/')[1],
        userId: user.id,
        isPrivate: false,
        isBackedUp: false,
      },
    });
    if (existing.userId !== user.id) {
      return NextResponse.json({ error: 'This repository is managed by another Rivet account.' }, { status: 403 });
    }
    const previousOutpoint = existing?.ckbCellOutpoint ?? undefined;

    const result = await dispatchBackup(
      repoFullName,
      user.id,
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
