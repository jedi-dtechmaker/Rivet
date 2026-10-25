import { NextRequest } from 'next/server';

export function walletRequestOrigin(req: NextRequest) {
  const expected = new URL(process.env.NEXTAUTH_URL || req.url).origin;
  if (req.headers.get('origin') !== expected) {
    throw new Error('Invalid request origin');
  }
  return expected;
}
