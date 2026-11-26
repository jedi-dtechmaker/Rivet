import { NextResponse } from 'next/server';
import { getPublicVellumIdentity } from '@/lib/vellum-identity';

export async function GET(_request: Request, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params;
  try {
    const identity = await getPublicVellumIdentity(username);
    if (!identity) return NextResponse.json({ error: 'No public Vellum identity.' }, { status: 404 });
    return NextResponse.json(identity, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch {
    return NextResponse.json({ error: 'Vellum identity verification is temporarily unavailable.' }, { status: 503 });
  }
}
