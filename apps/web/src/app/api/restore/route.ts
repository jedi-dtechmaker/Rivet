import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { dispatchRestore } from '@/lib/backupDispatch';

/**
 * Starts a restore job. Returns immediately (202); the git work (download the
 * IPFS bundle, expand it, create the repo, mirror-push) runs in the
 * "Repo Restore Worker" GitHub Actions workflow.
 *
 * There is no callback: the client polls /api/restore/status, which watches the
 * GitHub API for the new repository to appear.
 */

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { ipfsCid, repoName } = body ?? {};

    if (!ipfsCid || typeof ipfsCid !== 'string') {
      return NextResponse.json({ error: 'Missing ipfsCid' }, { status: 400 });
    }

    if (!repoName || typeof repoName !== 'string' || !NAME_PATTERN.test(repoName)) {
      return NextResponse.json({ error: 'Invalid repoName' }, { status: 400 });
    }

    const targetRepoName = `${repoName}-restored`;

    const result = await dispatchRestore({
      repoName,
      ipfsCid,
      targetRepoName,
      sessionToken: session.accessToken,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      {
        accepted: true,
        jobId: result.jobId,
        targetRepoName,
        runUrl: result.runUrl,
        startedAt: result.startedAt,
      },
      { status: 202 },
    );
  } catch (error: any) {
    console.error('[restore] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
