import Link from 'next/link';
import RepoListClient from './RepoListClient';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Search, Filter, ShieldCheck, Database, RefreshCw, FolderGit2, Star, Clock, AlertCircle } from 'lucide-react';
import { BackupButton } from '@/components/BackupButton';
import { WalletRepos } from './WalletRepos';
import { SyncButtonClient } from './SyncButtonClient';
import { db } from '@/lib/db';
import styles from './page.module.css';

export default async function Dashboard() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return <WalletRepos />;
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

  const githubRepos = await res.json();

  // Fetch our database records to see which ones are backed up
  const dbRepos = await db.findAllRepos();
  const dbRepoMap = new Map(dbRepos.map((r: any) => [r.githubRepoId, r]));

  // Map them to our UI format
  const repos = Array.isArray(githubRepos) ? githubRepos.map((r: any) => {
    const dbRepo: any = dbRepoMap.get(r.full_name);
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
  return (
    <div className={styles.dashboard}>
      {/* Dashboard Header & Stats */}
      <div className={styles.header}>
        <div className={styles.header__content}>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Manage your repositories and backups</p>
        </div>

        <div className={styles.actions}>
          <SyncButtonClient />
          <button className="btn btn--primary">
            <Database size={16} /> Backup All
          </button>
        </div>
      </div>

      <RepoListClient repos={repos} />
    </div>
  );
}
