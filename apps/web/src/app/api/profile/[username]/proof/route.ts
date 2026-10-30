import { NextResponse } from 'next/server';
import { publicIdentity } from '@/lib/public-identity';
export const maxDuration = 60;
export async function GET(_request: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    const identity = await publicIdentity((await params).username);
    if (!identity) return NextResponse.json({ error: 'Public identity not available.' }, { status: 404 });
    return NextResponse.json(identity, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not verify the public identity against CKB testnet. Retry shortly.' }, { status: 503 }); }
}
