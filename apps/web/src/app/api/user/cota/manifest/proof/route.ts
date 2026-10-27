import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exportManifestProof } from '@/lib/cota-manifest-service';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await exportManifestProof(session.user.id), { headers: {
      'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="rivet-cota-manifest-proof.json"',
    } });
  } catch {
    return NextResponse.json({ error: 'A confirmed CoTA manifest proof is not available yet.' }, { status: 404 });
  }
}
