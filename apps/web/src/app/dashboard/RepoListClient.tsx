'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, Filter, ShieldCheck, AlertCircle, Clock, Lock, Unlock, Hash, ChevronLeft, ChevronRight, FolderGit2 } from 'lucide-react';
import styles from './page.module.css';
import { BackupButton } from '@/components/BackupButton';

const ITEMS_PER_PAGE = 10;

export default function RepoListClient({ repos }: { repos: any[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | 'secured' | 'pending'>('all');

  // Calculate summary stats
  const totalRepos = repos.length;
  const backedUpCount = repos.filter((r: any) => r.backupStatus === 'backed_up').length;
  const pendingCount = repos.filter((r: any) => r.backupStatus === 'pending').length;

  // Filter repos based on search and active tab
  const filteredRepos = useMemo(() => {
    let result = repos;

    if (activeFilter === 'secured') {
      result = result.filter(repo => repo.backupStatus === 'backed_up');
    } else if (activeFilter === 'pending') {
      result = result.filter(repo => repo.backupStatus === 'pending');
    }

    if (!searchQuery.trim()) return result;
    
    return result.filter(repo => 
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [repos, searchQuery, activeFilter]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredRepos.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedRepos = filteredRepos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // Reset to page 1 when search or filter changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleFilterClick = (filter: 'all' | 'secured' | 'pending') => {
    setActiveFilter(filter);
    setCurrentPage(1);
  };

  return (
    <>
      {/* Stats Row / Tabs */}
      <div className={styles.stats}>
        <div 
          className={styles.stat_card} 
          onClick={() => handleFilterClick('all')}
          style={{ cursor: 'pointer', borderColor: activeFilter === 'all' ? 'var(--color-brand-primary)' : '' }}
        >
          <div className={styles.stat_icon}><FolderGit2 size={24} /></div>
          <div className={styles.stat_info}>
            <div className={styles.stat_value}>{totalRepos}</div>
            <div className={styles.stat_label}>Total Repositories</div>
          </div>
        </div>
        <div 
          className={styles.stat_card} 
          onClick={() => handleFilterClick('secured')}
          style={{ cursor: 'pointer', borderColor: activeFilter === 'secured' ? 'var(--color-brand-primary)' : '' }}
        >
          <div className={`${styles.stat_icon} ${styles['stat_icon--success']}`}><ShieldCheck size={24} /></div>
          <div className={styles.stat_info}>
            <div className={styles.stat_value}>{backedUpCount}</div>
            <div className={styles.stat_label}>Secured on CKB</div>
          </div>
        </div>
        <div 
          className={styles.stat_card} 
          onClick={() => handleFilterClick('pending')}
          style={{ cursor: 'pointer', borderColor: activeFilter === 'pending' ? 'var(--color-brand-primary)' : '' }}
        >
          <div className={`${styles.stat_icon} ${styles['stat_icon--warning']}`}><Clock size={24} /></div>
          <div className={styles.stat_info}>
            <div className={styles.stat_value}>{pendingCount}</div>
            <div className={styles.stat_label}>Pending Backup</div>
          </div>
        </div>
      </div>

      {/* Repo List Controls */}
      <div className={styles.controls}>
        <div className={styles.search_box}>
          <Search size={18} className={styles.search_icon} />
          <input 
            type="text" 
            placeholder="Search repositories..." 
            className={styles.search_input}
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>
      </div>

      {/* Repo Grid */}
      <div className={styles.grid}>
        {paginatedRepos.map((repo: any) => (
          <div key={repo.id} className={styles.card}>
            <div className={styles.card__header}>
              <Link href={`/${repo.fullName}`} className={styles.card__title}>
                {repo.name}
              </Link>
              {repo.isPrivate && (
                <span className="badge badge--info" style={{ marginLeft: '4px' }}>
                  Private
                </span>
              )}

              {repo.deletedOnGithub && (
                <span className="badge badge--error" style={{ marginLeft: '4px' }}>
                  <AlertCircle size={12} /> Deleted on GitHub
                </span>
              )}

              {repo.backupStatus === 'backed_up' && (
                <span className="badge badge--success">
                  <ShieldCheck size={12} /> Backed Up
                </span>
              )}
              {repo.backupStatus === 'pending' && (
                <span className="badge badge--warning">
                  <Clock size={12} /> Pending Backup
                </span>
              )}
            </div>

            <p className={styles.card__desc}>
              {repo.description}
            </p>

            <div className={styles.card__meta}>
              <div className={styles.meta_item}>
                <span className={styles.lang_dot} style={{ backgroundColor: '#ff5500' }}></span>
                {repo.language}
              </div>
              <div className={styles.meta_item}>
                ★ {repo.stars}
              </div>
            </div>
            
            <div className={styles.card__footer}>
               <div className={styles.footer_time}>
                 Updated: {repo.lastUpdated}
               </div>
               {repo.backupStatus === 'backed_up' ? (
                 <div className={styles.footer_backup}>
                   Secured: {repo.lastBackup}
                 </div>
               ) : repo.backupStatus === 'pending' ? (
                 <BackupButton repoFullName={repo.fullName} isPrivate={repo.isPrivate} />
               ) : null}
            </div>
          </div>
        ))}
      </div>

      {filteredRepos.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-dim)' }}>
          No repositories found matching your search.
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
          <button 
            className="btn btn--secondary" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            style={{ padding: '8px', opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: '14px', color: 'var(--color-text-dim)' }}>
            Page {currentPage} of {totalPages}
          </span>
          <button 
            className="btn btn--secondary" 
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            style={{ padding: '8px', opacity: currentPage === totalPages ? 0.5 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}
