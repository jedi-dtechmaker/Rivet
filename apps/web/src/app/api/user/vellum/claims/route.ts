import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { runVellumBackupClaimIssuance } from '@/lib/vellum-backup-claims';
import { walletRequestOrigin } from '@/lib/wallet-request';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { walletRequestOrigin(req); }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
  const user = await db.findUserByGithubId(session.user.id);
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  try {
    const result = await runVellumBackupClaimIssuance({ userId: user.id });
    return NextResponse.json({ status: result.status }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Claim issuance is temporarily unavailable. Existing claim state was preserved.' }, { status: 503 });
  }
}
