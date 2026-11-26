import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { createVellumIdentityChallenge } from '@/lib/vellum-identity';
import { VellumIdentityInactiveError, VellumIdentityUnavailableError } from '@/lib/vellum-controller';
import { walletRequestOrigin } from '@/lib/wallet-request';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
  let origin: string;
  try { origin = walletRequestOrigin(req); }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
  const user = await db.findUserByGithubId(session.user.id);
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  try {
    const body = await req.json();
    const challenge = await createVellumIdentityChallenge(user.id, body.did, origin);
    return NextResponse.json(challenge, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    if (error instanceof TypeError || error instanceof VellumIdentityInactiveError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof VellumIdentityUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: 'Could not prepare identity verification. Please retry.' }, { status: 503 });
  }
}
