import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { walletRequestOrigin } from '@/lib/wallet-request';

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
      
      const webhookUrl = `${appUrl}/api/webhook/github`;

      if (!appUrl || appUrl.includes('localhost')) {
        console.warn('Cannot configure webhooks automatically without a public NEXT_PUBLIC_APP_URL (e.g., Ngrok).');
      } else {
        const githubHeaders = {
          'Authorization': `Bearer ${session.accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        };

        const results = await Promise.all(backedUpRepos.map(async (repo) => {
          try {
            // First, find if we already have a webhook installed
            const hooksRes = await fetch(`https://api.github.com/repos/${repo.fullName}/hooks`, { headers: githubHeaders });
            if (!hooksRes.ok) return false;
            const hooks = await hooksRes.json();
            const existingHook = hooks.find((h: any) => h.config.url === webhookUrl);

            if (autoSync && !existingHook) {
              // Create Webhook
              const result = await fetch(`https://api.github.com/repos/${repo.fullName}/hooks`, {
                method: 'POST',
                headers: githubHeaders,
                body: JSON.stringify({
                  name: 'web',
                  active: true,
                  events: ['push'],
                  config: { url: webhookUrl, content_type: 'json', secret: webhookSecret }
                })
              });
              if (!result.ok) return false;
              console.log(`[Auto-Sync] Installed webhook on ${repo.fullName}`);
            } else if (!autoSync && existingHook) {
              // Delete Webhook
              const result = await fetch(`https://api.github.com/repos/${repo.fullName}/hooks/${existingHook.id}`, {
                method: 'DELETE',
                headers: githubHeaders
              });
              if (!result.ok) return false;
              console.log(`[Auto-Sync] Removed webhook from ${repo.fullName}`);
            }
            return true;
          } catch (e) {
            console.error(`[Auto-Sync] Error managing webhook for ${repo.fullName}:`, e);
            return false;
          }
        }));
        if (results.some(result => !result)) return NextResponse.json({ error: 'GitHub could not update every webhook. Check repository admin access and sign in again to grant webhook permission.' }, { status: 502 });
      }
    }

    if (autoSync) await db.updateUserSettings(githubId, { autoSync: true });

    return NextResponse.json({ success: true, autoSync });
  } catch (error: any) {
    console.error('Error updating Auto-Sync:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
