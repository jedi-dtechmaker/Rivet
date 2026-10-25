import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma, db } from '@/lib/db';
import { verifyWalletProof } from '@/lib/wallet-proof';
import { walletRequestOrigin } from '@/lib/wallet-request';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await db.findUserByGithubId(session.user.id);
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  return NextResponse.json({
    address: user.ckbAddress,
    verified: !!user.ckbAddressVerifiedAt,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
  try { walletRequestOrigin(req); }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }

  try {
    const body = await req.json();
    if (typeof body.challengeId !== 'string') {
      return NextResponse.json({ error: 'A wallet ownership challenge is required.' }, { status: 400 });
    }
    const user = await db.findUserByGithubId(session.user.id);
    if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    const challenge = await prisma.walletChallenge.findUnique({ where: { userId: user.id } });
    if (!challenge || challenge.id !== body.challengeId || challenge.expiresAt <= new Date()) {
      return NextResponse.json({ error: 'Wallet verification expired. Please retry.' }, { status: 400 });
    }
    if (!(await verifyWalletProof(challenge.message, challenge.address, body.proof))) {
      return NextResponse.json({ error: 'Could not verify ownership of this wallet.' }, { status: 400 });
    }

    await prisma.$transaction(async transaction => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824101)`;
      const registration = await transaction.cotaRegistration.findUnique({ where: { userId: user.id } });
      if (registration && registration.address !== challenge.address) throw new Error('Identity wallet cannot be replaced.');
      const consumed = await transaction.walletChallenge.deleteMany({
        where: { id: challenge.id, userId: user.id, expiresAt: { gt: new Date() } },
      });
      if (consumed.count !== 1) throw new Error('Wallet verification expired.');
      await transaction.user.update({
        where: { id: user.id },
        data: { ckbAddress: challenge.address, ckbAddressVerifiedAt: new Date() },
      });
    });
    return NextResponse.json({ success: true, address: challenge.address, verified: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'This wallet is already linked to another Rivet account.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Wallet verification could not finish. Please retry.' }, { status: 503 });
  }
}
