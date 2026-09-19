'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, History, GitBranch } from 'lucide-react';
import styles from './layout.module.css';

export function Tabs({ basePath, commitCount }: { basePath: string, commitCount: number }) {
  const pathname = usePathname();

  return (
    <div className={styles.repo_tabs}>
      <Link
        href={basePath}
        className={`${styles.tab} ${pathname === basePath ? styles['tab--active'] : ''}`}
      >
        <BookOpen size={16} /> Code
      </Link>
      <Link
        href={`${basePath}/commits`}
        className={`${styles.tab} ${pathname === `${basePath}/commits` ? styles['tab--active'] : ''}`}
      >
        <History size={16} /> Commits {commitCount > 0 && <span className={styles.tab_count}>{commitCount}</span>}
      </Link>
      <div className={styles.branch_selector}>
        <button className="btn btn--secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>
          <GitBranch size={14} /> main
        </button>
      </div>
    </div>
  );
}
