import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Direct proof updates are no longer supported. Start a backup from the dashboard; the authenticated worker callback saves its result.' }, { status: 410 });
}
