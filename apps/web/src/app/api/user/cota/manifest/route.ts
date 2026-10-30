import { readWithConnectionRetry } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { walletRequestOrigin } from '@/lib/wallet-request';
import { getManifestState, prepareManifest, submitManifest } from '@/lib/cota-manifest-service';
import { ManifestPublicationError } from '@/lib/cota-manifest-publication';
import { ManifestBackupMetadataError } from '@/lib/cota-manifest-backups';

export const maxDuration = 60;
function failure(error: unknown) {
  if (error instanceof ManifestBackupMetadataError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  if (error instanceof ManifestPublicationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  console.error('[cota-manifest] Request failed', { name: error instanceof Error ? error.name : undefined, code });
  const safe = /^(Verify your JoyID|Activate your user-owned|CoTA manifest|CoTA manifests|The (saved|verified|manifest|CoTA|expected|approved)|Another sponsored|Complete your saved|Run a fresh backup|A (public|saved|completed)|Public backup|This manifest)/;
  return NextResponse.json({ error: safe.test(message) ? message : 'Could not continue the saved CoTA manifest operation. Retry shortly.' }, { status: 503 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const githubId = session.user.id;
  try { return NextResponse.json(await readWithConnectionRetry(() => getManifestState(githubId)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { walletRequestOrigin(request); } catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1_000_000) return NextResponse.json({ error: 'Manifest request is too large.' }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid manifest request.' }, { status: 400 }); }
    if (body.action === 'prepare') return NextResponse.json(await prepareManifest(session.user.id, session.accessToken));
    if ((body.action === 'submit' || body.action === 'retry') && typeof body.operationId === 'string') {
      return NextResponse.json(await submitManifest(session.user.id, body.operationId, body.signedTransaction));
    }
    return NextResponse.json({ error: 'Invalid manifest action.' }, { status: 400 });
  } catch (error) { return failure(error); }
}
