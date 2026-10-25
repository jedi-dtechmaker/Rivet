import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ccc } from '@ckb-ccc/core';
import { CotaRegistration, Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { db, prisma } from '@/lib/db';
import { createTestnetClient } from '@/lib/ckb-server';
import { cotaTypeForLock, prepareCotaRegistration, registryRpc } from '@/lib/cota';
import { parseJoyIdAddress } from '@/lib/wallet-proof';
import { walletRequestOrigin } from '@/lib/wallet-request';

export const maxDuration = 60;

function logActivationFailure(stage: string, error: unknown) {
  const failure = error as { name?: string; code?: string; errorCode?: string; cause?: { code?: string } } | null;
  console.error('[cota] Activation failed', {
    stage,
    name: failure?.name,
    code: failure?.code || failure?.errorCode,
    causeCode: failure?.cause?.code,
  });
}

function publicRegistration(registration: CotaRegistration) {
  return {
    address: registration.address,
    status: registration.status,
    txHash: registration.txHash,
    outputIndex: registration.outputIndex,
    explorerUrl: `https://pudge.explorer.nervos.org/transaction/${registration.txHash}`,
  };
}

async function refreshRegistration(registration: CotaRegistration, client: ccc.Client) {
  if (registration.status === 'confirmed' || registration.status === 'rejected') return registration;
  const transaction = await client.getTransaction(registration.txHash);
  const status = transaction?.status === 'committed' ? 'confirmed'
    : transaction?.status === 'rejected' ? 'rejected'
    : transaction?.status === 'pending' || transaction?.status === 'proposed' ? 'submitted'
    : registration.status === 'submitted' && registration.transaction ? 'prepared'
    : registration.status;
  if (status === registration.status) return registration;
  return prisma.cotaRegistration.update({ where: { userId: registration.userId }, data: { status } });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const user = await db.findUserByGithubId(session.user.id);
    if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    const saved = await prisma.cotaRegistration.findUnique({ where: { userId: user.id } });
    const registration = saved ? await refreshRegistration(saved, createTestnetClient()) : null;
    return NextResponse.json({
      enabled: process.env.COTA_SPONSOR_ENABLED === 'true' && !!process.env.COTA_SPONSOR_PRIVATE_KEY,
      registration: registration ? publicRegistration(registration) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logActivationFailure('check-status', error);
    return NextResponse.json({ error: 'Could not check identity activation. Please retry.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
  try { walletRequestOrigin(req); }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }

  let stage = 'load-account';
  try {
    const client = createTestnetClient();
    let registration = await prisma.$transaction(async transaction => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824101)`;
      const user = await transaction.user.findUnique({ where: { githubId: session.user!.id! } });
      if (!user?.ckbAddress || !user.ckbAddressVerifiedAt) throw new Error('Verify your JoyID wallet first.');
      const previous = await transaction.cotaRegistration.findUnique({ where: { userId: user.id } });
      if (previous) return previous;
      stage = 'find-existing-cell';
      const owner = await parseJoyIdAddress(user.ckbAddress, client);
      const existingCell = await client.findSingletonCellByType(cotaTypeForLock(owner.script));
      if (existingCell) {
        if (!existingCell.cellOutput.lock.eq(owner.script)) throw new Error('Existing CoTA ownership does not match.');
        const existingTx = await client.getTransaction(existingCell.outPoint.txHash);
        if (existingTx?.status !== 'committed') throw new Error('An existing CoTA cell is awaiting confirmation.');
        return transaction.cotaRegistration.create({ data: {
          userId: user.id,
          address: user.ckbAddress,
          txHash: existingCell.outPoint.txHash,
          outputIndex: Number(existingCell.outPoint.index),
          status: 'confirmed',
        } });
      }

      if (process.env.COTA_SPONSOR_ENABLED !== 'true' || !process.env.COTA_SPONSOR_PRIVATE_KEY) {
        throw new Error('Sponsored identity activation is not available yet. Your backups still work.');
      }
      const limit = Number(process.env.COTA_SPONSOR_MAX_REGISTRATIONS || '10');
      if (!Number.isSafeInteger(limit) || limit <= 0 || await transaction.cotaRegistration.count({ where: { transaction: { not: Prisma.DbNull } } }) >= limit) {
        throw new Error('The identity sponsorship limit has been reached. Please try again later.');
      }
      const pending = await transaction.cotaRegistration.findFirst({ where: { status: { in: ['prepared', 'submitted'] } } });
      if (pending) throw new Error('Another sponsored activation is confirming. Please retry shortly.');
      stage = 'check-registry';
      const checked = await registryRpc<{ registered: boolean }>('check_registered_lock_hashes', owner.script.hash());
      if (checked.registered !== false) throw new Error('This wallet is already registered. Please wait for its CoTA cell to appear.');
      const sponsor = new ccc.SignerCkbPrivateKey(client, process.env.COTA_SPONSOR_PRIVATE_KEY);
      if ((await sponsor.getRecommendedAddressObj()).script.eq(owner.script)) throw new Error('The identity wallet must be separate from the sponsor.');
      stage = 'prepare-registration';
      const signed = await prepareCotaRegistration(client, owner.script, sponsor);
      stage = 'save-registration';
      return transaction.cotaRegistration.create({ data: {
        userId: user.id,
        address: user.ckbAddress,
        txHash: signed.hash(),
        outputIndex: 1,
        transaction: JSON.parse(signed.stringify()),
        status: 'prepared',
      } });
    }, { maxWait: 5000, timeout: 45000 });

    stage = 'check-transaction';
    registration = await refreshRegistration(registration, client);
    if (registration.status === 'rejected') {
      return NextResponse.json({ error: 'The activation transaction was rejected. Contact Rivet with its transaction hash.', registration: publicRegistration(registration) }, { status: 409 });
    }
    if (registration.status === 'prepared' && registration.transaction) {
      try {
        await client.sendTransaction(ccc.Transaction.from(registration.transaction as unknown as ccc.TransactionLike), 'passthrough');
        registration = await prisma.cotaRegistration.update({ where: { userId: registration.userId }, data: { status: 'submitted' } });
      } catch (error) {
        logActivationFailure('broadcast', error);
        return NextResponse.json({
          error: 'Activation could not be confirmed as submitted. Retry to resend the same transaction without creating another subsidy.',
          registration: publicRegistration(registration),
        }, { status: 503 });
      }
    }
    return NextResponse.json({ registration: publicRegistration(registration) }, { status: registration.status === 'confirmed' ? 200 : 202 });
  } catch (error) {
    logActivationFailure(stage, error);
    const message = error instanceof Error ? error.message : '';
    const allowed = [
      'Verify your JoyID wallet first.', 'Existing CoTA ownership does not match.',
      'An existing CoTA cell is awaiting confirmation.',
      'Sponsored identity activation is not available yet. Your backups still work.',
      'The identity sponsorship limit has been reached. Please try again later.',
      'Another sponsored activation is confirming. Please retry shortly.',
      'This wallet is already registered. Please wait for its CoTA cell to appear.',
      'CoTA registry could not be reached. Please retry shortly.',
      'CoTA registry is unavailable.', 'CoTA registry returned an invalid response.',
      'CoTA registry could not prepare registration.',
    ];
    return NextResponse.json({ error: allowed.includes(message) ? message : 'Identity activation could not finish. Please retry.' }, { status: 503 });
  }
}
