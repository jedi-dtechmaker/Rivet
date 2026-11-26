import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { runVellumBackupClaimIssuance } from '@/lib/vellum-backup-claims';
import {
  completeVellumIdentityChallenge,
  getVellumIdentityState,
  unlinkVellumIdentity,
  updateVellumIdentityVisibility,
  vellumIdentityConflict,
} from '@/lib/vellum-identity';
import { VellumIdentityInactiveError, VellumIdentityUnavailableError } from '@/lib/vellum-controller';
import { walletRequestOrigin } from '@/lib/wallet-request';

async function account() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return db.findUserByGithubId(session.user.id);
}

function verifyOrigin(req: NextRequest) {
  try { walletRequestOrigin(req); return null; }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
}

export async function GET() {
  const user = await account();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await getVellumIdentityState(user.id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Vellum identity status is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const user = await account();
  if (!user) return NextResponse.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
  const originError = verifyOrigin(req);
  if (originError) return originError;
  try {
    const body = await req.json();
    await completeVellumIdentityChallenge({ userId: user.id, challengeId: body.challengeId, signature: body.signature, isPublic: body.isPublic });
    await runVellumBackupClaimIssuance({ userId: user.id }).catch(() => undefined);
    return NextResponse.json(await getVellumIdentityState(user.id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (vellumIdentityConflict(error)) return NextResponse.json({ error: 'This identity is already linked to another Rivet account.' }, { status: 409 });
    if (error instanceof TypeError || error instanceof VellumIdentityInactiveError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof VellumIdentityUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: 'Identity linking could not finish. Please retry.' }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await account();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const originError = verifyOrigin(req);
  if (originError) return originError;
  try {
    const body = await req.json();
    await updateVellumIdentityVisibility(user.id, body.isPublic);
    if (body.isPublic === true) await runVellumBackupClaimIssuance({ userId: user.id }).catch(() => undefined);
    return NextResponse.json(await getVellumIdentityState(user.id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Link a Vellum identity first.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Identity visibility could not be updated.' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await account();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const originError = verifyOrigin(req);
  if (originError) return originError;
  try {
    await unlinkVellumIdentity(user.id);
    return NextResponse.json({ binding: null, claims: [], profileUrl: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'The identity could not be unlinked.' }, { status: 503 });
  }
}
