import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { dispatchBackup, isValidRepoFullName } from '@/lib/backupDispatch';

/**
 * GitHub push webhook handler.
 *
 * It only decides *whether* a backup should run and then dispatches the
 * GitHub Actions worker. All git work happens in the workflow, because Vercel
 * serverless functions have no `git` binary.
 */

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

function signatureMatches(provided: string, rawBody: string): boolean {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const expected = 'sha256=' + hmac.update(rawBody).digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    // Fail closed: without a secret we cannot trust the payload.
    if (!WEBHOOK_SECRET) {
      console.error('[webhook] GITHUB_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    if (!signature || !signatureMatches(signature, rawBody)) {
      console.error('[webhook] Signature mismatch or missing');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only process push events.
    if (req.headers.get('x-github-event') !== 'push') {
      return NextResponse.json({ message: 'Ignored non-push event' });
    }

    const payload = JSON.parse(rawBody);
    const repoFullName = payload?.repository?.full_name;
    const githubId = payload?.sender?.id?.toString();

    if (!isValidRepoFullName(repoFullName) || !githubId) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Resolve the owning user.
    let user = await db.findUserByGithubId(githubId);
    if (!user) {
      // Single-tenant/demo fallback: the push may come from a collaborator.
      user = await db.findFirstUser();
    }

    if (!user) {
      console.log(`[webhook] Ignoring push for ${repoFullName}: user not tracked.`);
      return NextResponse.json({ message: 'Not tracked' });
    }

    const existingRepo = await db.findRepo(repoFullName);
    if (!existingRepo) {
      await db.createRepo({
        githubRepoId: repoFullName,
        name: repoFullName.split('/')[1],
        fullName: repoFullName,
        isBackedUp: false,
        isPrivate: Boolean(payload?.repository?.private),
        lastBackupCid: '',
        ckbTxHash: '',
        userId: user.id,
      });
    }

    if (!user.autoSync) {
      console.log(
        `[webhook] Ignoring push for ${repoFullName}: auto-sync disabled for ${user.githubUsername}.`,
      );
      return NextResponse.json({ message: 'Auto-Sync is disabled' });
    }

    console.log(`[webhook] Dispatching backup worker for ${repoFullName} ...`);
    const result = await dispatchBackup(repoFullName);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { accepted: true, jobId: result.jobId, repoFullName },
      { status: 202 },
    );
  } catch (error: any) {
    console.error('[webhook] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
