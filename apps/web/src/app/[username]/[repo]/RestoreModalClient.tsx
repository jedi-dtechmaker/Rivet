'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X, Terminal, GitBranch, RefreshCw, Github, ExternalLink } from 'lucide-react';

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;

export function RestoreModalClient({ ipfsCid, repoName }: { ipfsCid: string, repoName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleAutomatedRestore = async () => {
    cancelledRef.current = false;
    stopPolling();
    setIsRestoring(true);
    setStatusText('Queueing restore worker...');
    setRestoreError(null);
    setRestoreSuccess(null);

    try {
      // 1. Dispatch the restore workflow. Returns immediately (202).
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ipfsCid, repoName }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start the restore');
      }

      if (data.runUrl) setRunUrl(data.runUrl);
      setStatusText('Restoring on GitHub Actions...');

      const targetRepoName: string = data.targetRepoName || `${repoName}-restored`;
      const startedAt = Date.now();

      // 2. Poll until the new repository appears on the user's account.
      pollRef.current = setInterval(async () => {
        if (cancelledRef.current) return;

        try {
          const s = await fetch(
            `/api/restore/status?targetRepoName=${encodeURIComponent(targetRepoName)}`,
            { cache: 'no-store' },
          );
          const sd = await s.json().catch(() => ({}));

          if (sd.status === 'done' && sd.restoredUrl) {
            stopPolling();
            setRestoreSuccess(sd.restoredUrl);
            setIsRestoring(false);
            return;
          }

          if (Date.now() - startedAt > MAX_WAIT_MS) {
            stopPolling();
            setIsRestoring(false);
            setRestoreError(
              'The restore is still running on GitHub Actions. Open the workflow run to check its progress.',
            );
            return;
          }
        } catch {
          // Transient network error: keep polling.
        }
      }, POLL_INTERVAL_MS);
    } catch (err: any) {
      stopPolling();
      setRestoreError(err.message);
      setIsRestoring(false);
    }
  };

  const trigger = (
    <button
      onClick={() => setIsOpen(true)}
      style={{
        background: 'none', border: 'none', display: 'inline-flex', alignItems: 'center',
        gap: '6px', color: 'var(--color-brand-primary)', fontSize: '13px', marginTop: '12px',
        cursor: 'pointer', padding: 0
      }}
    >
      <Download size={12} /> Download & Restore from IPFS
    </button>
  );

  if (!isOpen) {
    return trigger;
  }

  return (
    <>
      {trigger}

      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
      }}>
        <div style={{
          backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '600px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)', position: 'relative',
          maxHeight: '90vh', overflowY: 'auto'
        }}>
          <button
            onClick={() => setIsOpen(false)}
            style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>

          <h2 style={{ marginTop: 0, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={20} /> Restore Repository
          </h2>

          <p style={{ color: 'var(--color-text-dim)', lineHeight: 1.5, marginBottom: '24px' }}>
            Your repository is securely bundled and pinned to the IPFS network. You can download the `.bundle` file directly.
          </p>

          <div style={{ marginBottom: '24px' }}>
            <a
              href={`https://gateway.pinata.cloud/ipfs/${ipfsCid}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn--primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Download size={16} /> Download {repoName}.bundle
            </a>
          </div>

          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px', marginBottom: '16px' }}>
            <Terminal size={16} /> Exact Restore (Recommended)
          </h3>
          <p style={{ color: 'var(--color-text-dim)', fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
            To perfectly preserve the original commit hashes so they match the CKB Merkle proof, clone the bundle locally. <strong>Do not</strong> push this to a new GitHub repository, as GitHub will rewrite the commit hashes.
          </p>
          <div style={{ background: '#111', padding: '12px', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#0f0', marginBottom: '24px', overflowX: 'auto' }}>
            git clone {repoName}.bundle {repoName}-restored
          </div>

          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px', marginBottom: '16px' }}>
            <GitBranch size={16} /> Attribution Restore
          </h3>
          <p style={{ color: 'var(--color-text-dim)', fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
            If you just want the files and commit history on a new GitHub repository and do not care about breaking the Merkle cryptographic link, you can use the 1-Click Restore or do it manually.
          </p>

          <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--color-bg-secondary)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
            <h4 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px' }}>1-Click Automated Restore</h4>
            <p style={{ color: 'var(--color-text-dim)', fontSize: '13px', marginBottom: '16px' }}>
              We will download the bundle from IPFS and mirror-push it to a new repository named <strong>{repoName}-restored</strong> on your GitHub account. This runs as a background job, so it may take a minute.
            </p>

            {restoreSuccess ? (
              <div style={{ padding: '12px', background: 'rgba(0,255,0,0.1)', color: '#0f0', borderRadius: '6px', fontSize: '14px' }}>
                ✅ Successfully restored!{' '}
                <a href={restoreSuccess} target="_blank" rel="noreferrer" style={{ color: '#0f0', textDecoration: 'underline' }}>
                  View on GitHub
                </a>
              </div>
            ) : (
              <div>
                <button
                  className="btn btn--primary"
                  onClick={handleAutomatedRestore}
                  disabled={isRestoring}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#333' }}
                >
                  {isRestoring ? (
                    <><RefreshCw size={14} className="spin" /> {statusText || 'Restoring to GitHub...'}</>
                  ) : (
                    <><Github size={14} /> 1-Click Restore to GitHub</>
                  )}
                </button>
                {restoreError && (
                  <div style={{ color: 'var(--color-error)', fontSize: '13px', marginTop: '8px' }}>
                    {restoreError}
                    {runUrl && (
                      <>
                        {' '}
                        <a href={runUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-brand-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <ExternalLink size={11} /> View run
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <h4 style={{ fontSize: '14px', marginBottom: '8px', marginTop: '24px' }}>Manual Attribution Restore</h4>
          <div style={{ background: '#111', padding: '12px', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#0f0', overflowX: 'auto' }}>
            git clone {repoName}.bundle {repoName}-restored<br />
            cd {repoName}-restored<br />
            git remote set-url origin https://github.com/your-username/new-repo.git<br />
            git push -u origin main
          </div>
        </div>
      </div>
    </>
  );
}
