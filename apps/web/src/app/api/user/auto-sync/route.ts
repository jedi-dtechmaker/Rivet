import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !(session.user as any).id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { autoSync } = await req.json();

    if (typeof autoSync !== 'boolean') {
      return NextResponse.json({ error: 'Invalid autoSync value' }, { status: 400 });
    }

    const githubId = (session.user as any).id;
    await db.updateUserSettings(githubId, { autoSync });

    // Programmatically install or remove webhooks on GitHub
    const dbUser = await db.findUserByGithubId(githubId);
    if (dbUser && session.accessToken) {
      const repos = await db.findReposByUserId(dbUser.id);
      const backedUpRepos = repos.filter(r => r.isBackedUp);
      
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      const webhookUrl = `${appUrl}/api/webhook/github`;
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

      if (!appUrl || appUrl.includes('localhost')) {
        console.warn('Cannot configure webhooks automatically without a public NEXT_PUBLIC_APP_URL (e.g., Ngrok).');
      } else {
        const githubHeaders = {
          'Authorization': `Bearer ${session.accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        };

        await Promise.all(backedUpRepos.map(async (repo) => {
          try {
            // First, find if we already have a webhook installed
            const hooksRes = await fetch(`https://api.github.com/repos/${repo.fullName}/hooks`, { headers: githubHeaders });
            if (!hooksRes.ok) return;
            const hooks = await hooksRes.json();
            const existingHook = hooks.find((h: any) => h.config.url === webhookUrl);

            if (autoSync && !existingHook) {
              // Create Webhook
              await fetch(`https://api.github.com/repos/${repo.fullName}/hooks`, {
                method: 'POST',
                headers: githubHeaders,
                body: JSON.stringify({
                  name: 'web',
                  active: true,
                  events: ['push'],
                  config: { url: webhookUrl, content_type: 'json', secret: webhookSecret }
                })
              });
              console.log(`[Auto-Sync] Installed webhook on ${repo.fullName}`);
            } else if (!autoSync && existingHook) {
              // Delete Webhook
              await fetch(`https://api.github.com/repos/${repo.fullName}/hooks/${existingHook.id}`, {
                method: 'DELETE',
                headers: githubHeaders
              });
              console.log(`[Auto-Sync] Removed webhook from ${repo.fullName}`);
            }
          } catch (e) {
            console.error(`[Auto-Sync] Error managing webhook for ${repo.fullName}:`, e);
          }
        }));
      }
    }

    return NextResponse.json({ success: true, autoSync });
  } catch (error: any) {
    console.error('Error updating Auto-Sync:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
