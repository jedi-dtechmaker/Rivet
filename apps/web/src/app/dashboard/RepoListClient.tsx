'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  ShieldCheck,
  AlertCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  LockKeyhole,
  Star,
  ArrowUpRight,
  SearchX,
} from 'lucide-react';
import styles from './page.module.css';
import { BackupButton } from '@/components/BackupButton';

const ITEMS_PER_PAGE = 10;

export default function RepoListClient({ repos }: { repos: any[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | 'secured' | 'pending'>('all');
  const backedUpCount = repos.filter((repo) => repo.backupStatus === 'backed_up').length;
  const pendingCount = repos.filter((repo) => repo.backupStatus === 'pending' && !repo.isPrivate).length;

  const filteredRepos = useMemo(
    () =>
      repos.filter((repo) => {
        if (activeFilter === 'secured' && repo.backupStatus !== 'backed_up') return false;
        if (activeFilter === 'pending' && (repo.backupStatus !== 'pending' || repo.isPrivate)) return false;
        const query = searchQuery.trim().toLowerCase();
        return (
          !query || repo.name.toLowerCase().includes(query) || repo.description?.toLowerCase().includes(query)
        );
      }),
    [repos, searchQuery, activeFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredRepos.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const paginatedRepos = filteredRepos.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const summaries = [
    { filter: 'all' as const, label: 'All repositories', value: repos.length, icon: FolderGit2, tone: '' },
    {
      filter: 'secured' as const,
      label: 'Backed up',
      value: backedUpCount,
      icon: ShieldCheck,
      tone: 'stat_icon--success',
    },
    {
      filter: 'pending' as const,
      label: 'Needs backup',
      value: pendingCount,
      icon: Clock,
      tone: 'stat_icon--warning',
    },
  ];

  return (
    <section aria-label="Your repositories">
      <div className={styles.stats}>
        {summaries.map(({ filter, label, value, icon: Icon, tone }) => (
          <button
            key={filter}
            type="button"
            aria-pressed={activeFilter === filter}
            className={styles.stat_card}
            onClick={() => {
              setActiveFilter(filter);
              setCurrentPage(1);
            }}
          >
            <span className={styles.stat_label}>{label}</span>
            <span className={`${styles.stat_icon} ${tone ? styles[tone] : ''}`}>
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <strong className={styles.stat_value}>{value}</strong>
            <span className={styles.stat_hint}>
              {filter === 'all'
                ? 'Your GitHub workspace'
                : filter === 'secured'
                  ? 'Saved and recoverable'
                  : 'Ready when you are'}
              <ArrowUpRight size={12} aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <h2 className={styles.sectionTitle}>
          Repositories <span>{filteredRepos.length}</span>
        </h2>
        <div className={styles.search_box}>
          <Search size={16} className={styles.search_icon} aria-hidden="true" />
          <input
            type="search"
            placeholder="Find a repository…"
            aria-label="Search repositories"
            className={styles.search_input}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
      </div>

      <div className={styles.grid}>
        {paginatedRepos.map((repo) => (
          <article key={repo.id} className={styles.card}>
            <div className={styles.card__header}>
              <span className={styles.repoIcon}>
                <FolderGit2 size={21} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div className={styles.repoIdentity}>
                <span className={styles.repoOwner}>{repo.fullName.split('/')[0]}</span>
                <Link href={`/${repo.fullName}`} className={styles.card__title}>
                  {repo.name}
                </Link>
              </div>
              <Link href={`/${repo.fullName}`} className={styles.openRepo} aria-label={`Open ${repo.name}`}>
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <div className={styles.cardBadges}>
              {repo.isPrivate && (
                <span className={styles.privateBadge}>
                  <LockKeyhole size={11} aria-hidden="true" /> Private
                </span>
              )}
              {repo.deletedOnGithub && (
                <span className="badge badge--error">
                  <AlertCircle size={11} aria-hidden="true" /> Deleted on GitHub
                </span>
              )}
              {repo.backupStatus === 'backed_up' && (
                <span className="badge badge--success">
                  <ShieldCheck size={11} aria-hidden="true" /> Backed up
                </span>
              )}
              {repo.backupStatus === 'pending' && !repo.isPrivate && (
                <span className={styles.pendingBadge}>
                  <span /> Not backed up
                </span>
              )}
            </div>
            <p className={styles.card__desc}>{repo.description}</p>
            {repo.isPrivate && (
              <p className={styles.privateNote} role="note">
                Public repositories only during testnet.
              </p>
            )}
            <div className={styles.card__meta}>
              <span className={styles.meta_item}>
                <span className={styles.lang_dot} />
                {repo.language}
              </span>
              <span className={styles.meta_item}>
                <Star size={12} aria-hidden="true" />
                {repo.stars}
              </span>
              <span className={styles.footer_time}>Updated {repo.lastUpdated}</span>
            </div>
            <div className={styles.card__footer}>
              {repo.backupStatus === 'backed_up' ? (
                <>
                  <span className={styles.savedLabel}>
                    <ShieldCheck size={13} aria-hidden="true" /> Saved {repo.lastBackup}
                  </span>
                  {!repo.deletedOnGithub && !repo.isPrivate && (
                    <BackupButton repoFullName={repo.fullName} refresh />
                  )}
                </>
              ) : !repo.isPrivate ? (
                <>
                  <span className={styles.readyLabel}>Give your code a backup.</span>
                  <BackupButton repoFullName={repo.fullName} />
                </>
              ) : (
                <span className={styles.readyLabel}>Private backups are coming later.</span>
              )}
            </div>
          </article>
        ))}
      </div>

      {filteredRepos.length === 0 && (
        <div className={styles.emptyState}>
          <SearchX size={28} strokeWidth={1.5} aria-hidden="true" />
          <h3>{repos.length ? 'No repositories match' : 'Your workspace starts here'}</h3>
          <p>
            {repos.length
              ? 'Try a different name or clear your filters.'
              : 'Your GitHub repositories will appear here. Refresh the list after creating a repository.'}
          </p>
          {repos.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('all');
                setCurrentPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Repository pagination">
          <span className={styles.paginationSummary}>
            Showing {startIndex + 1}–{Math.min(startIndex + ITEMS_PER_PAGE, filteredRepos.length)} of{' '}
            {filteredRepos.length}
          </span>
          <div className={styles.pageControls}>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => setCurrentPage(page - 1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span>
              Page <strong>{page}</strong> of {totalPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={page === totalPages}
              onClick={() => setCurrentPage(page + 1)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
