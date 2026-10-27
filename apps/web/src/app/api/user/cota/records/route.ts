import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma, readWithConnectionRetry } from '@/lib/db';
import { walletRequestOrigin } from '@/lib/wallet-request';
import { prepareRecords, publicUpdate, refreshCotaUpdate, submitRecords } from '@/lib/cota-records';
import { cotaRecordFailure } from '@/lib/cota-record-errors';
import { WITNESS_PROTOCOL } from '@/lib/identity-proof';

export const maxDuration = 60;

function failure(error: unknown, stage: string) {
  const message = error instanceof Error ? error.message : '';
  const safe = /^(Verify your JoyID|Activate your CoTA|The user-owned|Your CoTA|A saved backup|A backup anchor|This identity supports|The identity update exceeds|The CoTA cell needs|An earlier update|The signed transaction differs|Identity update not found|Approve this identity|The identity update was rejected|Account not found)/;
  const result = cotaRecordFailure(error);
  console.error('[cota-records] Request failed', { stage, ...result.diagnostics });
  return NextResponse.json({ error: result.message || (safe.test(message) ? message : 'Could not synchronize identity records. Retry to continue the saved update.') }, { status: result.status });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const user = await readWithConnectionRetry(() => prisma.user.findUnique({ where: { githubId: session.user.id } }));
    if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    const latest = await readWithConnectionRetry(() => prisma.cotaUpdate.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }));
    const update = latest ? await refreshCotaUpdate(latest) : null;
    return NextResponse.json({ update: update ? publicUpdate(update) : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, 'status'); }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { walletRequestOrigin(request); }
  catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
  let stage = 'prepare';
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'prepare') {
      if (process.env.COTA_MANIFEST_ENABLED === 'true') {
        return NextResponse.json({ error: 'Use the CoTA manifest flow to store new records in your CoTA tree. Earlier signed-witness proofs remain available.' }, { status: 409 });
      }
      if (body.protocol !== undefined && body.protocol !== WITNESS_PROTOCOL) {
        return NextResponse.json({ error: 'Choose signed proof anchoring to prepare a new transaction.' }, { status: 400 });
      }
      const result = await prepareRecords(session.user.id, undefined, body.protocol);
      const update = await refreshCotaUpdate(result.update);
      return NextResponse.json({ update: publicUpdate(update), unchanged: result.unchanged });
    }
    if (body.action === 'submit' && typeof body.id === 'string') {
      stage = 'submit';
      const update = await submitRecords(session.user.id, body.id, body.transaction);
      return NextResponse.json({ update: publicUpdate(update) }, { status: update.status === 'confirmed' ? 200 : 202 });
    }
    return NextResponse.json({ error: 'Invalid identity update action.' }, { status: 400 });
  } catch (error) { return failure(error, stage); }
}
