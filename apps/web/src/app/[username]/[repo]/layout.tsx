import Link from 'next/link';
import { BookOpen, ShieldCheck, Database, AlertCircle } from 'lucide-react';
import { Tabs } from './Tabs';
import { db } from '@/lib/db';
import styles from './layout.module.css';

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { username: string; repo: string };
}) {
  const basePath = `/${params.username}/${params.repo}`;
  const fullName = `${params.username}/${params.repo}`;
  
  const repo = await db.findRepo(fullName);

  return (
    <div className={styles.repo_container}>
      {/* Repo Header */}
      <div className={styles.repo_header}>
        <div className={styles.repo_title_row}>
          <div className={styles.repo_title}>
            <BookOpen size={20} className={styles.repo_icon} />
            <Link href={`/${params.username}`} className={styles.repo_owner}>
              {params.username}
            </Link>
            <span className={styles.repo_separator}>/</span>
            <Link href={basePath} className={styles.repo_name}>
              {params.repo}
            </Link>
            
            {repo?.isBackedUp ? (
              <span className="badge badge--success">
                <ShieldCheck size={12} /> CKB Secured
              </span>
            ) : (
              <span className="badge badge--warning">
                <AlertCircle size={12} /> Unsecured
              </span>
            )}
          </div>

          <div className={styles.repo_actions}>
            <div className={styles.action_group}>
              {repo?.ckbTxHash ? (
                <a 
                  href={`https://pudge.explorer.nervos.org/transaction/${repo.ckbTxHash}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="btn btn--secondary" 
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  <Database size={14} /> View on CKB Explorer
                </a>
              ) : (
                <button className="btn btn--secondary" disabled style={{ padding: '6px 12px', fontSize: '12px', opacity: 0.5 }}>
                  <Database size={14} /> Not on CKB yet
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Tabs */}
        <Tabs basePath={basePath} commitCount={repo?.commitCount || 0} />
      </div>

      {/* Main Content Area */}
      <div className={styles.repo_content}>
        {children}
      </div>
    </div>
  );
}
