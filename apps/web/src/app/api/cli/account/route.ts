import { NextResponse } from 'next/server';
import { cliAccount } from '@/lib/cli-auth';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const account = await cliAccount(request);
    if (!account) return NextResponse.json({ error: 'Use a GitHub token for an existing Rivet account.' }, { status: 401, headers });
    return NextResponse.json({ githubId: account.user.githubId, username: account.user.githubUsername || null }, { headers });
  } catch { return NextResponse.json({ error: 'Could not check sign-in. Retry shortly.' }, { status: 503, headers }); }
}
