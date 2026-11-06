'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export type SettingsResult = { error: string; saved: boolean };

export async function saveSettings(previousState: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { error: 'Sign in with GitHub before saving your settings.', saved: false };
  const bio = formData.get('bio');
  if (typeof bio !== 'string' || bio.trim().length > 160) return { error: 'Your bio must be 160 characters or fewer.', saved: false };
  try {
    const user = await db.findUserByGithubId(session.user.id);
    if (!user) return { error: 'Your Rivet account could not be found. Please sign in again.', saved: false };
    await db.updateUserSettings(session.user.id, { bio: bio.trim(), isProfilePublic: formData.get('isProfilePublic') === 'on' });
    if (user.githubUsername) revalidatePath(`/${user.githubUsername}`);
    revalidatePath('/settings');
    revalidatePath('/explore');
    return { error: '', saved: true };
  } catch { return { error: 'Your settings could not be saved. Please retry.', saved: false }; }
}
