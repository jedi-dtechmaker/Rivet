import Link from 'next/link';
import { FolderGit2, GitCommitHorizontal } from 'lucide-react';
import { findPublicBackups } from '@/lib/public-backups';
import { ContentPage, EmptyState } from '@/components/ContentPage';
import styles from '@/components/ContentPage.module.css';

export const metadata = { title: 'Explore public backups · Rivet' };
export const dynamic = 'force-dynamic';

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, 200) : '';
  const requestedPage = Number(params.page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1000 ? requestedPage : 1;
  let repositories: Awaited<ReturnType<typeof findPublicBackups>> = [];
  let unavailable = false;
  try { repositories = await findPublicBackups(query, page); }
  catch { unavailable = true; }
  const hasMore = repositories.length > 24;

  return <ContentPage title="Discover code with a backup plan." description="Browse public repository backups shared by developers on Rivet. Open a repository to inspect its saved history, or look up its anchor." actions={<Link href="/dashboard" className="btn btn--primary">Back up your own code</Link>}>
    <form action="/explore" method="get" className={styles.search} role="search"><label htmlFor="explore-query" className="sr-only">Search public repository backups</label><input id="explore-query" type="search" name="q" defaultValue={query} maxLength={200} placeholder="Search owner/repository" /><button type="submit" className="btn btn--primary">Search backups</button>{query && <Link href="/explore">Clear search</Link>}</form>
    {unavailable ? <EmptyState title="Public backups couldn’t load"><p>The directory is temporarily unavailable. Try again shortly, or open your own dashboard.</p><Link href={`/explore?q=${encodeURIComponent(query)}`} className="btn btn--secondary">Try again</Link></EmptyState>
      : repositories.length === 0 ? <EmptyState title={query ? 'No public backups match that search' : page > 1 ? 'You’ve reached the end' : 'The public directory starts with you'}><p>{query ? 'Try a repository owner or name. Only completed public backups from public profiles appear here.' : 'Back up a public repository and keep your profile public to make it discoverable here.'}</p><div className={styles.actions}>{query || page > 1 ? <Link href="/explore" className="btn btn--secondary">Browse all public backups</Link> : <Link href="/dashboard" className="btn btn--primary">Create your first backup</Link>}<Link href="/docs#quick-start">Read the quick start →</Link></div></EmptyState>
      : <section className={styles.section} aria-label="Public backup directory"><h2>{query ? 'Matching backups' : 'Recently updated backups'}</h2><div className={styles.grid}>{repositories.slice(0, 24).map(repository => <article key={repository.id} className={styles.card}><FolderGit2 size={24} aria-hidden="true" /><h3><Link href={`/${repository.fullName}`}>{repository.fullName}</Link></h3><span className="badge badge--success">Backup saved</span><div className={styles.meta}><span><GitCommitHorizontal size={14} aria-hidden="true" /> {repository.commitCount} commits</span><span>Updated {repository.updatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span></div><Link href={`/verify?q=${encodeURIComponent(repository.fullName)}`}>Check backup anchor →</Link></article>)}</div></section>}
    {!unavailable && (page > 1 || hasMore) && <nav className={styles.pagination} aria-label="Public backup pages">{page > 1 ? <Link href={`/explore?q=${encodeURIComponent(query)}&page=${page - 1}`} className="btn btn--secondary">Previous</Link> : <span />}<span>Page {page}</span>{hasMore && <Link href={`/explore?q=${encodeURIComponent(query)}&page=${page + 1}`} className="btn btn--secondary">Next</Link>}</nav>}
    <details className={styles.details}><summary>Which repositories appear here?</summary><div><p>Only completed backups of public repositories whose Rivet owner has a public profile. Private profiles and private repositories are excluded.</p><p>A saved backup entry is not an independent proof of authorship or file availability. Use its anchor lookup or the verification guides for the specific checks you need.</p><Link href="/docs#verification">Read about verification →</Link></div></details>
  </ContentPage>;
}
