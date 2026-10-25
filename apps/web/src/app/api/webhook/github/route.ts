import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db, prisma } from '@/lib/db';
import { dispatchBackup, isValidRepoFullName } from '@/lib/backupDispatch';
import { PRIVATE_BACKUP_MESSAGE, readPublicRepository } from '@/lib/public-repository';

/**
 * GitHub push webhook handler.
 *
 * It only decides *whether* a backup should run and then dispatches the
 * GitHub Actions worker. All git work happens in the workflow, because Vercel
 * serverless functions have no `git` binary.
 */

function signatureMatches(provided: string, rawBody: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
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
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    // Fail closed: without a secret we cannot trust the payload.
    if (!webhookSecret) {
      console.error('[webhook] GITHUB_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    if (!signature || !signatureMatches(signature, rawBody, webhookSecret)) {
      console.error('[webhook] Signature mismatch or missing');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only process push events.
    if (req.headers.get('x-github-event') !== 'push') {
      return NextResponse.json({ message: 'Ignored non-push event' });
    }

    const payload = JSON.parse(rawBody);
    const repoFullName = payload?.repository?.full_name;
    if (!isValidRepoFullName(repoFullName)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const existingRepo = await db.findRepo(repoFullName);
    if (!existingRepo) return NextResponse.json({ message: 'Repository is not registered. Start its first backup from the dashboard.' });
    if (payload?.repository?.private !== false || existingRepo.isPrivate) return NextResponse.json({ error: PRIVATE_BACKUP_MESSAGE }, { status: 403 });
    const user = await prisma.user.findUnique({ where: { id: existingRepo.userId } });
    if (!user) return NextResponse.json({ message: 'Repository account not found.' });

    if (!user.autoSync) {
      console.log(
        `[webhook] Ignoring push for ${repoFullName}: auto-sync disabled for ${user.githubUsername}.`,
      );
      return NextResponse.json({ message: 'Auto-Sync is disabled' });
    }

    const access = await readPublicRepository(repoFullName);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    console.log(`[webhook] Dispatching backup worker for ${repoFullName} ...`);
    // Pass the anchor cell outpoint so auto-sync reuses the repo's existing cell
    // instead of creating a new one on every push.
    const result = await dispatchBackup(
      repoFullName,
      user.id,
      existingRepo?.ckbCellOutpoint ?? undefined,
    );

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
