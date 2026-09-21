import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Polled by the client while the restore workflow runs. It watches the user's
 * own GitHub account for the new repository, so no job table is needed.
 */

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const targetRepoName = req.nextUrl.searchParams.get('targetRepoName');
    if (!targetRepoName || !NAME_PATTERN.test(targetRepoName)) {
      return NextResponse.json({ error: 'Invalid targetRepoName' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Could not read GitHub profile' }, { status: 502 });
    }
    const login = (await userRes.json()).login;

    const repoRes = await fetch(`https://api.github.com/repos/${login}/${targetRepoName}`, {
      headers,
    });

    if (repoRes.status === 404) {
      return NextResponse.json({ status: 'pending' });
    }
    if (!repoRes.ok) {
      return NextResponse.json({ error: 'Could not read the repository' }, { status: 502 });
    }

    const repo = await repoRes.json();

    // The repo is created before the push, so wait until it has content.
    if (!repo.size || repo.size === 0) {
      return NextResponse.json({ status: 'pending' });
    }

    return NextResponse.json({ status: 'done', restoredUrl: repo.html_url });
  } catch (error: any) {
    console.error('[restore/status] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
