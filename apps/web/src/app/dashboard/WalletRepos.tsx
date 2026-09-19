'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ccc } from '@ckb-ccc/connector-react';
import { ShieldCheck, BookOpen, AlertCircle, Hash, FolderGit2 } from 'lucide-react';
import { getReposByAddress } from './actions';
import styles from './page.module.css';

export function WalletRepos() {
  const { wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    async function loadRepos() {
      if (signer) {
        try {
          const addr = await signer.getRecommendedAddress();
          setAddress(addr);
          setLoading(true);
          const fetched = await getReposByAddress(addr);
          setRepos(fetched);
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }
      } else {
        setRepos([]);
        setLoading(false);
      }
    }
    loadRepos();
  }, [signer]);

  if (!wallet) {
    return (
      <div className={styles.dashboard} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <AlertCircle size={48} style={{ color: 'var(--color-primary)', marginBottom: '1rem' }} />
        <h2 style={{ marginBottom: '1rem' }}>GitHub Not Connected</h2>
        <p style={{ color: 'var(--color-text-dim)', marginBottom: '2rem' }}>You must connect your GitHub account or a CKB Wallet to view your repositories.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.dashboard} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
        <p style={{ color: 'var(--color-text-dim)' }}>Loading your secured repositories from CKB Wallet...</p>
      </div>
    );
  }

  const securedCount = repos.filter(r => r.isBackedUp).length;

  const totalPages = Math.ceil(repos.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedRepos = repos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <div className={styles.header__content}>
          <h1 className={styles.title}>Secured Repositories</h1>
          <p className={styles.subtitle}>Viewing from CKB Wallet: <span style={{ fontFamily: 'monospace' }}>{address ? `${address.slice(0, 10)}...${address.slice(-8)}` : 'Loading...'}</span></p>
          <p style={{ color: 'var(--color-warning)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Note: GitHub is unlinked. You can view your secured repositories, but you cannot back up new changes until you link GitHub again.
          </p>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat_card}>
          <div className={styles.stat_icon}><FolderGit2 size={24} /></div>
          <div className={styles.stat_info}>
            <div className={styles.stat_value}>{repos.length}</div>
            <div className={styles.stat_label}>Total Known Repos</div>
          </div>
        </div>
        <div className={styles.stat_card}>
          <div className={`${styles.stat_icon} ${styles['stat_icon--success']}`}><ShieldCheck size={24} /></div>
          <div className={styles.stat_info}>
            <div className={styles.stat_value}>{securedCount}</div>
            <div className={styles.stat_label}>Secured on CKB</div>
          </div>
        </div>
      </div>

      <div className={styles.grid} style={{ marginTop: '2rem' }}>
        {paginatedRepos.map((repo) => (
          <div key={repo.id} className={styles.card}>
            <div className={styles.card__header}>
              <Link href={`/${repo.fullName}`} className={styles.card__title}>
                {repo.name}
              </Link>
              {repo.isBackedUp ? (
                <span className="badge badge--success">
                  <ShieldCheck size={12} /> Backed Up
                </span>
              ) : (
                <span className="badge badge--warning">
                  Unsecured
                </span>
              )}
            </div>

            <p className={styles.card__desc} style={{ opacity: 0.7 }}>
              {repo.fullName}
            </p>

            <div className={styles.card__meta} style={{ marginTop: 'auto', paddingTop: '1rem' }}>
              <div className={styles.meta_item}>
                <Hash size={14} /> {repo.ckbTxHash ? `${repo.ckbTxHash.slice(0, 10)}...` : 'No transaction'}
              </div>
            </div>
            
            <div className={styles.card__footer}>
               <div className={styles.footer_time}>
                 Last Backup: {repo.updatedAt ? new Date(repo.updatedAt).toLocaleDateString() : 'Never'}
               </div>
            </div>
          </div>
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
            Previous
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
            Next
          </button>
        </div>
      )}
    </div>
  );
}
