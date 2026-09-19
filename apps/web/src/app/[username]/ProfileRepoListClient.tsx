'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, AlertCircle, Hash, Github, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './page.module.css';

const ITEMS_PER_PAGE = 10;

export default function ProfileRepoListClient({ username, repos }: { username: string, repos: any[] }) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(repos.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedRepos = repos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <>
      <div className={styles.repos_grid}>
        {paginatedRepos.map((repo) => (
          <Link href={`/${username}/${repo.name}`} key={repo.id} className={styles.repo_card}>
            <div className={styles.repo_card_header}>
              <div className={styles.repo_name}>
                <Github size={18} />
                {repo.name}
                {repo.isBackedUp && (
                  <ShieldCheck size={16} color="var(--color-success)" title="Secured on CKB" style={{ marginLeft: '4px' }} />
                )}
              </div>
              {repo.isPrivate && (
                <div className="badge badge--info" style={{ marginLeft: '4px', transform: 'scale(0.85)' }}>
                  Private
                </div>
              )}
            </div>
            
            <div className={styles.repo_meta}>
              <div className={styles.meta_item}>
                <Hash size={12} />
                {repo.ckbTxHash ? `${repo.ckbTxHash.substring(0, 10)}...` : 'Pending TX'}
              </div>
            </div>
          </Link>
        ))}
      </div>

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
