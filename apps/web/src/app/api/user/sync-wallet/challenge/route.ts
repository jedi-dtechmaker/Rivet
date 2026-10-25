import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db, prisma } from '@/lib/db';
import { createTestnetClient } from '@/lib/ckb-server';
import { createWalletMessage, parseJoyIdAddress } from '@/lib/wallet-proof';
import { walletRequestOrigin } from '@/lib/wallet-request';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const githubId = session?.user?.id;
  if (!githubId) return NextResponse.json({ error: 'Sign in with GitHub first.' }, { status: 401 });

  let origin: string;
  try { origin = walletRequestOrigin(req); }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }

  try {
    const body = await req.json();
    let address: string;
    try { address = (await parseJoyIdAddress(body.ckbAddress, createTestnetClient())).toString(); }
    catch { return NextResponse.json({ error: 'Connect a CKB testnet JoyID wallet.' }, { status: 400 }); }
    const user = await db.findUserByGithubId(githubId);
    if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    const registration = await prisma.cotaRegistration.findUnique({ where: { userId: user.id } });
    if (registration && registration.address !== address) {
      return NextResponse.json({ error: 'Reconnect the wallet that owns your CoTA identity.' }, { status: 409 });
    }

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const message = createWalletMessage(origin, githubId, address, id, expiresAt);
    const data = { id, address, message, expiresAt };
    await prisma.walletChallenge.upsert({
      where: { userId: user.id },
      create: { ...data, userId: user.id },
      update: data,
    });
    return NextResponse.json({ challengeId: id, message, address, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not prepare wallet verification. Please retry.' }, { status: 503 });
  }
}
