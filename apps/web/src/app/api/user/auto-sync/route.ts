import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { walletRequestOrigin } from '@/lib/wallet-request';
import { configureRepositoryHook } from '@/lib/github-hooks';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try { walletRequestOrigin(req); }
    catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }

    const { autoSync } = await req.json();

    if (typeof autoSync !== 'boolean') {
      return NextResponse.json({ error: 'Invalid autoSync value' }, { status: 400 });
    }

    const githubId = (session.user as any).id;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (autoSync && (!appUrl || !webhookSecret || new URL(appUrl).hostname === 'localhost')) {
      return NextResponse.json({ error: 'Auto Sync needs a public app URL and a configured webhook secret.' }, { status: 503 });
    }
    if (!autoSync) await db.updateUserSettings(githubId, { autoSync: false });

    // Programmatically install or remove webhooks on GitHub
    const dbUser = await db.findUserByGithubId(githubId);
    if (dbUser && session.accessToken) {
      const repos = await db.findReposByUserId(dbUser.id);
      const backedUpRepos = repos.filter(r => r.isBackedUp && (!autoSync || !r.isPrivate));
      
      if (appUrl && !appUrl.includes('localhost')) {
        // Bound parallel GitHub requests; reads retry, hook mutations reconcile through the next list operation.
        for (let offset = 0; offset < backedUpRepos.length; offset += 4) {
          const results = await Promise.allSettled(backedUpRepos.slice(offset, offset + 4).map(repo =>
            configureRepositoryHook(repo.fullName, session.accessToken!, autoSync)));
          if (results.some(result => result.status === 'rejected')) return NextResponse.json({ error: 'GitHub could not update every webhook. Check repository admin access and sign in again to grant webhook permission.' }, { status: 502 });
        }
      }
    }

    if (autoSync) await db.updateUserSettings(githubId, { autoSync: true });

    return NextResponse.json({ success: true, autoSync });
  } catch (error: any) {
    console.error('Error updating Auto-Sync:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
