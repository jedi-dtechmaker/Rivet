import { prisma } from './db';

/** Personal GitHub tokens are used only to authenticate each CLI request. */
export async function cliAccount(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 1000) return null;
  const token = authorization.slice(7);
  const response = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) return null;
  const github = await response.json();
  if (!Number.isSafeInteger(github.id) || github.id <= 0) return null;
  const user = await prisma.user.findUnique({ where: { githubId: String(github.id) } });
  return user ? { user, token } : null;
}
