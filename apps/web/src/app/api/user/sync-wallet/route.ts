import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma, db } from '@/lib/db';

/**
 * Links the signed-in GitHub account to a CKB address.
 *
 * The address can come from any lock CCC exposes — JoyID (passkey), OmniLock
 * via MetaMask/EVM, OmniLock via a Bitcoin wallet, Nostr, or a native secp256k1
 * CKB wallet. Rivet never needs the user's key: anchoring is sponsored by the
 * Rivet treasury, so linking a wallet is about identity and ownership, not
 * custody.
 */

// Bech32 CKB addresses: ckb1... on mainnet, ckt1... on testnet.
const CKB_ADDRESS_PATTERN = /^(ckb|ckt)1[02-9ac-hj-np-z]+$/;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const githubId = (session?.user as any)?.id as string | undefined;

    if (!session || !githubId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const ckbAddress: unknown = body?.ckbAddress;

    if (!ckbAddress || typeof ckbAddress !== 'string') {
      return NextResponse.json({ error: 'Missing ckbAddress' }, { status: 400 });
    }

    if (!CKB_ADDRESS_PATTERN.test(ckbAddress)) {
      return NextResponse.json({ error: 'Invalid CKB address' }, { status: 400 });
    }

    const user = await db.findUserByGithubId(githubId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // ckbAddress is @unique, so guard against stealing another account's link.
    const existing = await prisma.user.findUnique({ where: { ckbAddress } });
    if (existing && existing.id !== user.id) {
      return NextResponse.json(
        { error: 'That wallet is already linked to a different Rivet account' },
        { status: 409 },
      );
    }

    if (user.ckbAddress === ckbAddress) {
      return NextResponse.json({ success: true, updated: false, ckbAddress });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { ckbAddress },
    });

    return NextResponse.json({ success: true, updated: true, ckbAddress });
  } catch (error) {
    console.error('[sync-wallet] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Unlink the wallet from the signed-in account. */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    const githubId = (session?.user as any)?.id as string | undefined;

    if (!session || !githubId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.findUserByGithubId(githubId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { ckbAddress: null },
    });

    return NextResponse.json({ success: true, unlinked: true });
  } catch (error) {
    console.error('[sync-wallet] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
