import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Sends the signed-in user to their own public profile.
 *
 * Note: users are keyed by their Github numeric id, not their email.
 * `auth.ts` stores `githubId = profile.id.toString()` and the session callback
 * exposes it as `session.user.id` — looking this up by email never matched, so
 * this route used to fall through to /dashboard.
 */
export default async function ProfileRedirect() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/');
  }

  const githubId = (session.user as any)?.id as string | undefined;
  const user = githubId ? await db.findUserByGithubId(githubId) : null;

  if (!user) {
    // Signed in, but never synced a backup — nothing to show yet.
    redirect('/dashboard');
  }

  // Prefer the stored handle; otherwise derive it from a repo's fullName.
  let handle = user.githubUsername ?? null;
  if (!handle) {
    const repos = await db.findReposByUserId(user.id);
    const firstFullName = repos.find((r) => r.fullName)?.fullName;
    handle = firstFullName ? firstFullName.split('/')[0] : null;
  }

  if (handle) {
    redirect(`/${handle}`);
  }

  redirect('/dashboard');
}
