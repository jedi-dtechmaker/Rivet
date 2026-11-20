import Link from 'next/link';
import RepoListClient from './RepoListClient';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AlertCircle, ArrowUpRight } from 'lucide-react';
import { HelpButton } from '@/components/ActionDialog';
import { SyncButtonClient } from './SyncButtonClient';
import { AutoSyncToggle } from '@/components/AutoSyncToggle';
import { db } from '@/lib/db';
import type { Repository } from '@prisma/client';
import styles from './page.module.css';

export default async function Dashboard() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <div className={styles.dashboard} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <AlertCircle size={48} style={{ color: 'var(--color-primary)', marginBottom: '1rem' }} />
        <h2 style={{ marginBottom: '1rem' }}>GitHub Not Connected</h2>
        <p style={{ color: 'var(--color-text-dim)', marginBottom: '2rem' }}>You must sign in with your GitHub account to manage your repositories.</p>
        <Link href="/api/auth/signin" className="btn btn--primary">Sign in with GitHub</Link>
      </div>
    );
  }

  // Fetch real repositories from GitHub API
  // @ts-ignore
  const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
    headers: {
      // @ts-ignore
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
    next: { revalidate: 60 } // Cache for 60 seconds
  });

  let githubRepos: any[] = [];
  let githubError: string | null = null;

  if (res.ok) {
    githubRepos = await res.json();
  } else {
    const errorData = await res.json();
    githubError = errorData.message || 'Failed to fetch repositories from GitHub';
    console.error("GitHub API Error:", errorData);
  }

  // Fetch our database records to see which ones are backed up
  // @ts-ignore
  const userId = session.user?.id;
  const dbUser = userId ? await db.findUserByGithubId(userId) : null;
  const dbRepos = dbUser ? await db.findReposByUserId(dbUser.id) : [];
  
  const dbRepoMap = new Map<string, Repository>(
    dbRepos.map((r: Repository) => [r.fullName, r] as [string, Repository])
  );

  // Map them to our UI format
  const repos = Array.isArray(githubRepos) ? githubRepos.map((r: any) => {
    const dbRepo = dbRepoMap.get(r.full_name);
    return {
      id: r.id.toString(),
      name: r.name,
      fullName: r.full_name,
      description: r.description || 'No description provided.',
      language: r.language || 'Unknown',
      stars: r.stargazers_count,
      commits: '—',
      isPrivate: r.private,
      backupStatus: dbRepo?.isBackedUp ? 'backed_up' : 'pending',
      lastBackup: dbRepo?.updatedAt ? new Date(dbRepo.updatedAt).toLocaleDateString() : null,
      lastUpdated: new Date(r.updated_at).toLocaleDateString(),
      deletedOnGithub: false
    };
  }) : [];

  // Append any repositories that are backed up in our DB but were deleted on GitHub
  // ONLY do this if we successfully fetched from GitHub, otherwise we might falsely assume they are deleted!
  if (!githubError) {
    dbRepos.forEach((dbRepo: any) => {
      if (dbRepo.isBackedUp && !repos.find((r: any) => r.fullName === dbRepo.fullName)) {
        repos.push({
          id: dbRepo.id,
          name: dbRepo.name,
          fullName: dbRepo.fullName,
          description: 'This repository has been deleted from GitHub but is safely backed up on IPFS and CKB.',
          language: 'Unknown',
          stars: 0,
          commits: dbRepo.commitCount || '—',
          isPrivate: dbRepo.isPrivate,
          backupStatus: 'backed_up',
          lastBackup: new Date(dbRepo.updatedAt).toLocaleDateString(),
          lastUpdated: new Date(dbRepo.updatedAt).toLocaleDateString(),
          deletedOnGithub: true
        });
      }
    });
  }
  return (
    <div className={styles.dashboard}>
      {/* Dashboard Header & Stats */}
      <div className={styles.header}>
        <div className={styles.header__content}>
          <div className={styles.eyebrow}>Your workspace <span className={styles.networkBadge}><span /> CKB testnet</span></div>
          <h1 className={styles.title}>Your backups</h1>
          <p className={styles.subtitle}>
            A home for your repositories. A backup for what comes next.
          </p>
        </div>

        <div className={styles.actions}>
          {dbUser && <AutoSyncToggle initialAutoSync={dbUser.autoSync} />}
          <SyncButtonClient />
          <HelpButton title="Back up your repositories" label="Quick guide">
            <p>Choose a public repository and select <strong>Back up now</strong>. Rivet saves its Git history to IPFS and records a proof on CKB testnet.</p>
            <p><strong>Refresh repositories</strong> reloads your GitHub repository list. <strong>Update backup</strong> saves a newer version of a repository you have already backed up.</p>
            <p><strong>Auto-backup</strong> starts backups when Rivet receives GitHub push events for your repositories.</p>
            <p>You can back up without connecting a wallet. Open <strong>Developer identity</strong> in the navigation to link backup proofs to your JoyID wallet.</p>
          </HelpButton>
        </div>
      </div>

      <div className={styles.backupNote}><span>Public Git history. Encrypted backups. Fees covered by Rivet.</span><Link href="/docs#restore">Recovery guide <ArrowUpRight size={14} aria-hidden="true" /></Link></div>

      {githubError && (
        <div className={styles.errorNotice} role="alert">
          <AlertCircle size={20} />
          <div>
            <strong>GitHub API Error:</strong> {githubError}.<br/>
            Your GitHub access token may have expired or you hit a rate limit. Please try signing out and signing back in to refresh it.
          </div>
        </div>
      )}

      <RepoListClient repos={repos} />
    </div>
  );
}
