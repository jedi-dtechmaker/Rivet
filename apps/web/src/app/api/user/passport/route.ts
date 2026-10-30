import { readWithConnectionRetry } from '@/lib/db';
import { ccc } from '@ckb-ccc/core';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { walletRequestOrigin } from '@/lib/wallet-request';
import { getPassport, preparePassport, submitPassport } from '@/lib/passport-service';
export const maxDuration = 60;
const failure = () => NextResponse.json({ error: 'Passport request could not finish. Check wallet funds and refresh the saved mint status before retrying.' }, { status: 503 });
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const githubId = session.user.id;
  try { return NextResponse.json(await readWithConnectionRetry(() => getPassport(githubId)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return failure(); }
}
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { walletRequestOrigin(request); } catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 150000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  try {
    if (body.action === 'prepare') return NextResponse.json(await preparePassport(session.user.id));
    if (body.action === 'submit') return NextResponse.json(await submitPassport(session.user.id, body.signedTransaction));
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error instanceof ccc.ErrorTransactionInsufficientCapacity) return NextResponse.json({ error: 'Your JoyID wallet needs more available test CKB for the passport capacity, change and fee. Your CoTA identity cell will not be spent.' }, { status: 422 });
    return failure();
  }
}
