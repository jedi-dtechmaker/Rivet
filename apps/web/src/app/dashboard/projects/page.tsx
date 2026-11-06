import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { FolderGit2, CheckCircle2 } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { ContentPage, EmptyState } from '@/components/ContentPage';
import styles from '@/components/ContentPage.module.css';

export const metadata = { title: 'Projects · Rivet' };

export default async function ProjectsPage() {
  const session = await getServerSession(authOptions);
  let repositories: Awaited<ReturnType<typeof db.findReposByUserId>> = [];
  let unavailable = false;
  if (session?.user?.id) {
    try {
      const user = await db.findUserByGithubId(session.user.id);
      if (user) repositories = await db.findReposByUserId(user.id);
    } catch { unavailable = true; }
  }

  return <ContentPage title="Your projects, with a backup plan." description="Repositories you have saved in Rivet, with their latest backup status. GitHub project boards and issue tracking stay on GitHub." actions={<><Link href="/dashboard" className="btn btn--primary">Back up a repository</Link><Link href="/docs#restore" className="btn btn--secondary">Plan a recovery</Link></>}>
    {!session?.user?.id ? <EmptyState title="Sign in to see your projects"><p>Your saved repositories will appear here after you sign in with GitHub.</p><Link href="/api/auth/signin" className="btn btn--primary">Sign in with GitHub</Link></EmptyState>
      : unavailable ? <EmptyState title="Your projects couldn’t load"><p>Your saved records are unchanged. Try reloading this page in a moment.</p><Link href="/dashboard/projects" className="btn btn--secondary">Try again</Link></EmptyState>
      : repositories.length === 0 ? <EmptyState title="Your first project starts with a backup"><p>Open the dashboard, choose a public repository, and start a backup. Its saved record will appear here.</p><Link href="/dashboard" className="btn btn--primary">Choose a repository</Link></EmptyState>
      : <section className={styles.section} aria-label="Saved projects"><p>{repositories.length} saved repositor{repositories.length === 1 ? 'y' : 'ies'} · {repositories.filter(repository => repository.isBackedUp).length} backed up</p><div className={styles.grid}>
        {repositories.map(repository => <article key={repository.id} className={styles.card}><FolderGit2 size={24} aria-hidden="true" /><h2>{repository.fullName}</h2><span className={repository.isBackedUp ? styles.status : styles.meta}>{repository.isBackedUp && <CheckCircle2 size={16} aria-hidden="true" />}{repository.isBackedUp ? 'Backed up' : 'Backup not complete'}</span><p>{repository.isPrivate ? 'Private repository. Backup and restore are unavailable in this testnet release.' : `${repository.commitCount} commits in the latest saved record.`}</p><div className={styles.meta}><span>Updated {repository.updatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span></div>{!repository.isPrivate && <Link href={`/${repository.fullName}`}>Open repository →</Link>}</article>)}
      </div></section>}
    <section className={styles.section}><h2>Keep each project recoverable</h2><div className={styles.grid}><article className={styles.card}><h3>Save new work</h3><p>Use <strong>Update backup</strong> after important changes or releases. Refreshing the repository list alone does not create a backup.</p></article><article className={styles.card}><h3>Keep a recovery file</h3><p>The source CLI can export a private recovery file for a completed backup. Store it outside your Git repository.</p><Link href="/docs#restore">Read the recovery steps →</Link></article></div></section>
  </ContentPage>;
}
