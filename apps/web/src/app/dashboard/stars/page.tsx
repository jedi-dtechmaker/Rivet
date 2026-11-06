import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { Star, GitFork } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { ContentPage, EmptyState } from '@/components/ContentPage';
import styles from '@/components/ContentPage.module.css';

export const metadata = { title: 'Stars · Rivet' };
type StarredRepository = { id: number; full_name: string; description: string | null; language: string | null; stargazers_count: number; forks_count: number };

export default async function StarsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await getServerSession(authOptions);
  const requestedPage = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1000 ? requestedPage : 1;
  let repositories: StarredRepository[] = [];
  let hasMore = false;
  let unavailable = false;
  if (session?.accessToken) {
    try {
      const response = await fetch(`https://api.github.com/user/starred?sort=created&direction=desc&per_page=24&page=${page}`, {
        headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('GitHub stars unavailable');
      const result = await response.json();
      if (!Array.isArray(result)) throw new Error('Unexpected GitHub response');
      repositories = result;
      hasMore = /<[^>]+>; rel="next"/.test(response.headers.get('link') || '');
    } catch { unavailable = true; }
  }

  return <ContentPage title="The projects you keep coming back to." description="Your GitHub starred repositories, most recently starred first. Open a project on GitHub to manage its star." actions={<Link href="/explore" className="btn btn--secondary">Explore public backups</Link>}>
    {!session?.accessToken ? <EmptyState title="Bring your GitHub stars with you"><p>Sign in to browse the repositories you have starred. Starring a repository does not automatically back it up in Rivet.</p><Link href="/api/auth/signin" className="btn btn--primary">Sign in with GitHub</Link></EmptyState>
      : unavailable ? <EmptyState title="GitHub stars couldn’t load"><p>GitHub may be temporarily unavailable, rate-limited, or need a fresh sign-in. Your stars have not changed.</p><div className={styles.actions}><Link href={`/dashboard/stars?page=${page}`} className="btn btn--secondary">Try again</Link><Link href="/api/auth/signin" className="btn btn--secondary">Refresh GitHub sign-in</Link></div></EmptyState>
      : repositories.length === 0 ? <EmptyState title={page > 1 ? 'No more starred repositories' : 'Your collection is waiting'}><p>Star a repository on GitHub, then return here to find it again.</p>{page > 1 && <Link href="/dashboard/stars">Back to your newest stars</Link>}<Link href="/explore">Explore public Rivet backups →</Link></EmptyState>
      : <div className={styles.grid}>{repositories.map(repository => <article key={repository.id} className={styles.card}><Star size={24} aria-hidden="true" /><h2>{repository.full_name}</h2><p>{repository.description || 'No description added on GitHub.'}</p><div className={styles.meta}>{repository.language && <span>{repository.language}</span>}<span><Star size={14} aria-hidden="true" /> {repository.stargazers_count.toLocaleString()}</span><span><GitFork size={14} aria-hidden="true" /> {repository.forks_count.toLocaleString()}</span></div><a href={`https://github.com/${repository.full_name}`} target="_blank" rel="noreferrer">Open on GitHub ↗</a></article>)}</div>}
    {session?.accessToken && !unavailable && (page > 1 || hasMore) && <nav className={styles.pagination} aria-label="Starred repository pages">{page > 1 ? <Link href={`/dashboard/stars?page=${page - 1}`} className="btn btn--secondary">Previous</Link> : <span />}<span>Page {page}</span>{hasMore && <Link href={`/dashboard/stars?page=${page + 1}`} className="btn btn--secondary">Next</Link>}</nav>}
    <details className={styles.details}><summary>Does starring a repository create a backup?</summary><div><p>No. Stars are your GitHub bookmarks. To create a backup in Rivet, use a public repository you own or have permission to write to, then start its backup from the dashboard.</p><Link href="/docs#quick-start">Learn how backups work →</Link></div></details>
  </ContentPage>;
}
