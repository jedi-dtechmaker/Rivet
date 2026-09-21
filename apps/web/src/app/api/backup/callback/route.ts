import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';

/**
 * Receives the result of a backup job from the GitHub Actions worker and
 * persists it. Authenticated with a shared secret header.
 */

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    // A dedicated secret is preferred. NEXTAUTH_SECRET is accepted as a
    // fallback so the setup needs no brand-new value.
    const expected = process.env.BACKUP_CALLBACK_SECRET || process.env.NEXTAUTH_SECRET;
    if (!expected) {
      console.error(
        '[backup/callback] Neither BACKUP_CALLBACK_SECRET nor NEXTAUTH_SECRET is configured',
      );
      return NextResponse.json({ error: 'Callback not configured' }, { status: 500 });
    }

    if (!secretMatches(req.headers.get('x-backup-secret'), expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      jobId,
      repoFullName,
      success,
      merkleRoot,
      ipfsCid,
      ckbTxHash,
      ckbCellOutpoint,
      commitsProcessed,
      error,
    }: {
      jobId?: string;
      repoFullName?: string;
      success?: boolean;
      merkleRoot?: string;
      ipfsCid?: string;
      ckbTxHash?: string;
      ckbCellOutpoint?: string;
      commitsProcessed?: number;
      error?: string;
    } = body ?? {};

    if (!repoFullName || !REPO_PATTERN.test(repoFullName)) {
      return NextResponse.json({ error: 'Invalid repoFullName' }, { status: 400 });
    }

    // Worker-side failure: record it and acknowledge so Actions stops retrying.
    if (!success) {
      console.error(`[backup/callback] Job ${jobId} failed for ${repoFullName}: ${error}`);
      return NextResponse.json({ acknowledged: true, success: false });
    }

    if (!ipfsCid || !ckbTxHash) {
      return NextResponse.json(
        { error: 'Missing ipfsCid or ckbTxHash' },
        { status: 400 },
      );
    }

    const existingRepo = await db.findRepo(repoFullName);

    if (existingRepo) {
      await db.updateRepo(repoFullName, {
        isBackedUp: true,
        lastBackupCid: ipfsCid,
        ckbTxHash,
        ...(ckbCellOutpoint ? { ckbCellOutpoint } : {}),
        ...(typeof commitsProcessed === 'number' ? { commitCount: commitsProcessed } : {}),
      });
      console.log(`[backup/callback] Updated ${repoFullName} -> ${ckbTxHash}`);
    } else {
      // The repo was never tracked (e.g. backed up before first visit).
      const user = await db.findFirstUser();
      if (!user) {
        console.error(`[backup/callback] No user to attach ${repoFullName} to`);
        return NextResponse.json({ error: 'No user available' }, { status: 409 });
      }

      await db.createRepo({
        githubRepoId: repoFullName,
        name: repoFullName.split('/')[1],
        fullName: repoFullName,
        isBackedUp: true,
        isPrivate: false,
        commitCount: commitsProcessed ?? 0,
        lastBackupCid: ipfsCid,
        ckbTxHash,
        ...(ckbCellOutpoint ? { ckbCellOutpoint } : {}),
        userId: user.id,
      });
      console.log(`[backup/callback] Created ${repoFullName} -> ${ckbTxHash}`);
    }

    return NextResponse.json({
      acknowledged: true,
      success: true,
      merkleRoot: merkleRoot ?? null,
    });
  } catch (e: any) {
    console.error('[backup/callback] Error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
