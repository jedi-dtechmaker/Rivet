import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { ContentPage, EmptyState } from '@/components/ContentPage';
import { AutoSyncToggle } from '@/components/AutoSyncToggle';
import { SettingsForm } from './SettingsForm';
import styles from '@/components/ContentPage.module.css';

export const metadata = { title: 'Settings · Rivet' };

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  let user: Awaited<ReturnType<typeof db.findUserByGithubId>> = null;
  let unavailable = false;
  if (session?.user?.id) {
    try { user = await db.findUserByGithubId(session.user.id); }
    catch { unavailable = true; }
  }
  return <ContentPage title="Make Rivet work your way." description="Manage your profile, choose what you share, and control automatic backups." actions={<Link href="/dashboard" className="btn btn--secondary">Back to your backups</Link>}>
    {!session?.user?.id ? <EmptyState title="Sign in to manage your settings"><p>Your profile and backup preferences belong to your GitHub account. A wallet is optional.</p><Link href="/api/auth/signin" className="btn btn--primary">Sign in with GitHub</Link></EmptyState>
      : unavailable || !user ? <EmptyState title="Your account settings couldn’t load"><p>Try again shortly, or sign in again if your Rivet account has not been created yet.</p><Link href="/settings" className="btn btn--secondary">Try again</Link></EmptyState>
      : <><SettingsForm bio={user.bio || ''} isProfilePublic={user.isProfilePublic} /><section className={styles.card}><h2>Automatic backups</h2><p>Configure push-triggered backups for your already backed-up public repositories. This control saves immediately and reports any GitHub webhook setup errors.</p><AutoSyncToggle initialAutoSync={user.autoSync} /></section><section className={styles.card}><h2>Wallet and developer identity</h2><p>Connect or disconnect JoyID, check your identity, and manage passport approvals from the dashboard.</p><Link href="/dashboard#identity">Manage developer identity →</Link></section></>}
  </ContentPage>;
}
