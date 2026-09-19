import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function ProfileRedirect() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    redirect('/');
  }

  // Find the user by their email (which we used as githubId)
  // We have to use Prisma directly here since db.ts doesn't have a findUserByGithubId helper
  const { prisma } = await import('@/lib/db');
  
  const user = await prisma.user.findUnique({
    where: { githubId: session.user.email }
  });

  if (!user) {
    // If they haven't backed anything up yet, they don't have a profile. Go to dashboard.
    redirect('/dashboard');
  }

  // We need their actual github login handle, which is the prefix of their repositories.
  // Let's get their first repository to extract the handle.
  const repo = await prisma.repository.findFirst({
    where: { userId: user.id }
  });

  if (repo && repo.fullName) {
    const handle = repo.fullName.split('/')[0];
    redirect(`/${handle}`);
  }

  // Fallback
  redirect('/dashboard');
}
