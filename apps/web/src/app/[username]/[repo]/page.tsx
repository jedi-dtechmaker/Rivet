import { db } from '@/lib/db';
import { headers } from 'next/headers';
import { ShieldCheck, Database, Link as LinkIcon, FileArchive, Download, Code } from 'lucide-react';
import { FileTree } from '@/components/repo/FileTree';
import { RestoreModalClient } from './RestoreModalClient';
import styles from './page.module.css';

export default async function RepoHome({ params }: { params: { username: string; repo: string } }) {
  const fullName = `${params.username}/${params.repo}`;
  const repo = await db.findRepo(fullName);

  // Dynamically determine the base URL
  const headersList = headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  return (
    <div className={styles.repo_home}>
      {/* Description */}
      <div className={styles.about_section}>
        <p className={styles.description}>
          A decentralized platform that backs up, timestamps, and restores your GitHub history using CKB blockchain.
        </p>
        <div className={styles.tags}>
          <span className={styles.tag}>typescript</span>
          <span className={styles.tag}>nextjs</span>
          <span className={styles.tag}>ckb</span>
          <span className={styles.tag}>rgb++</span>
        </div>
      </div>

      {/* File Tree */}
      <FileTree basePath={`/${fullName}`} cachedTree={repo?.cachedTree} />

      {/* Cryptographic Proofs Panel */}
      <div className={styles.readme} style={{ marginTop: '24px' }}>
        <div className={styles.readme_header}>
          <ShieldCheck size={16} /> Cryptographic Proofs
        </div>
        <div className={styles.readme_body}>
          {repo?.isBackedUp ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* Blockchain Anchor */}
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '16px' }}>
                  <Database size={16} color="var(--color-brand-primary)" /> CKB Blockchain Anchor
                </h3>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '14px', marginBottom: '12px' }}>
                  This cryptographic proof demonstrates that this repository's exact state existed by a certain CKB block, verifying data integrity and timestamp.
                </p>
                <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }}>
                  {repo.ckbTxHash}
                </div>
                <a href={`https://pudge.explorer.nervos.org/transaction/${repo.ckbTxHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-brand-primary)', fontSize: '13px', marginTop: '12px' }}>
                  <LinkIcon size={12} /> View on CKB Explorer
                </a>
              </div>

              <hr style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />

              {/* IPFS Data & Restore */}
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '16px' }}>
                  <FileArchive size={16} color="var(--color-brand-primary)" /> IPFS Decentralized Storage
                </h3>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '14px', marginBottom: '12px' }}>
                  The entire repository history is bundled and pinned to the global IPFS network.
                </p>
                <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }}>
                  {repo.lastBackupCid}
                </div>
                {repo.lastBackupCid && (
                  <RestoreModalClient ipfsCid={repo.lastBackupCid} repoName={params.repo} />
                )}
              </div>

              <hr style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />

              {/* README Badge */}
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '16px' }}>
                  <Code size={16} color="var(--color-brand-primary)" /> Verified Backup Badge
                </h3>
                <p style={{ color: 'var(--color-text-dim)', fontSize: '14px', marginBottom: '12px' }}>
                  Add this badge to your GitHub README to publicly prove this repository is backed up on CKB.
                </p>
                <div style={{ background: '#111', color: '#0f0', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '13px', overflowX: 'auto', whiteSpace: 'pre' }}>
                  {`[![Secured on CKB](https://img.shields.io/badge/Secured%20on-CKB-00CC9B?style=for-the-badge&logo=nervosnetwork)](${baseUrl}/verify?q=${repo.ckbTxHash})`}
                </div>
              </div>

            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-dim)' }}>
              <ShieldCheck size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
              <h3>Not Secured Yet</h3>
              <p>Go to your dashboard to backup and secure this repository on CKB.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
