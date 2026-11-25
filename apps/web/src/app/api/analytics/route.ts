import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { analyticsEnabled, recordPageView } from '@/lib/analytics';
import { isTrackedPage } from '@/lib/analytics-policy';
import { walletRequestOrigin } from '@/lib/wallet-request';

export async function POST(request: NextRequest) {
  if (!analyticsEnabled()) return new NextResponse(null, { status: 204 });
  try { walletRequestOrigin(request); }
  catch { return new NextResponse(null, { status: 403 }); }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return new NextResponse(null, { status: 415 });
  }
  const body = await request.text();
  if (body.length > 128) return new NextResponse(null, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(body); } catch { return new NextResponse(null, { status: 400 }); }
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('page' in value) || !isTrackedPage(value.page)) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const session = value.page === 'dashboard' ? await getServerSession(authOptions) : null;
    await recordPageView(value.page, session?.user?.id);
  } catch {
    console.error('[analytics] Could not record page view. Check the analytics setup.');
  }
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
