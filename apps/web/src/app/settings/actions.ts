'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db, prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function saveSettings(formData: FormData) {
  const session = await getServerSession(authOptions);
  
  if (!session || !session.user?.email) {
    throw new Error('Unauthorized');
  }

  const isProfilePublic = formData.get('isProfilePublic') === 'on';
  const autoSync = formData.get('autoSync') === 'on';
  const bio = formData.get('bio') as string | null;
  const ckbAddress = formData.get('ckbAddress') as string;

  if (!ckbAddress) {
    throw new Error('CKB Address is required to update settings');
  }

  // Find user to verify ownership
  const user = await prisma.user.findUnique({
    where: { ckbAddress }
  });

  if (!user || user.githubId !== session.user.email) {
    throw new Error('Unauthorized or User not found');
  }

  await db.updateUserSettings(ckbAddress, {
    isProfilePublic,
    autoSync,
    bio: bio || undefined,
  });

  if (user.githubUsername) {
    revalidatePath(`/${user.githubUsername}`);
  }
  revalidatePath('/settings');
}
