'use client';

import { useState, useRef, useEffect } from 'react';
import { LoaderCircle, ShieldCheck, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ActionDialog } from './ActionDialog';
import styles from './BackupButton.module.css';

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 15 * 60 * 1000;

export function BackupButton({ repoFullName, isPrivate = false, refresh = false }: { repoFullName: string, isPrivate?: boolean, refresh?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'backing_up' | 'backed_up'>('idle');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);

  const router = useRouter();
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

  const handleBackup = async () => {
    if (isPrivate) return;
    cancelledRef.current = false;
    stopPolling();

    try {
      setStatus('backing_up');
      setStatusText('Starting your backup…');
      setErrorMsg(null);

      // 1. Dispatch the GitHub Actions worker. Returns immediately (202).
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName, isPrivate }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start backup');
      }

      const since = data.startedAt || new Date().toISOString();
      if (data.runUrl) setRunUrl(data.runUrl);

      setStatusText('Saving your repository…');

      // 2. Poll until the worker reports back through /api/backup/callback.
      const startedAt = Date.now();

      pollRef.current = setInterval(async () => {
        if (cancelledRef.current) return;

        try {
          const s = await fetch(
            `/api/backup/status?repoFullName=${encodeURIComponent(repoFullName)}&since=${encodeURIComponent(since)}`,
            { cache: 'no-store' },
          );
          const sd = await s.json().catch(() => ({}));

          if (sd.status === 'done') {
            stopPolling();
            setStatusText('Backup complete');
            setTxHash(sd.ckbTxHash ?? null);
            setStatus('backed_up');
            router.refresh();
            return;
          }

          if (Date.now() - startedAt > MAX_WAIT_MS) {
            stopPolling();
            setStatus('idle');
            setErrorMsg(
              'The backup is still running on GitHub Actions. Open the workflow run to check its progress.',
            );
            return;
          }

          setStatusText('Saving your repository…');
        } catch {
          // Transient network error: keep polling.
        }
      }, POLL_INTERVAL_MS);
    } catch (e: any) {
      stopPolling();
      console.error(e);
      setErrorMsg(e.message || 'An unexpected error occurred during the backup process.');
      setStatus('idle');
    }
  };

  if (isPrivate) {
    return <span className={styles.note} role="note">Public repositories only on testnet.</span>;
  }

  if (status === 'backed_up') {
    return (
      <div className={styles.result}>
        <span className="badge badge--success" style={{ padding: '4px 8px' }}>
          <ShieldCheck size={12} /> Backed up
        </span>
        {txHash && (
          <a
            href={`https://pudge.explorer.nervos.org/transaction/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        )}
      </div>
    );
  }

  if (status === 'backing_up') {
    return (
      <div className={styles.result} aria-busy="true">
        <span className={styles.progress} role="status"><LoaderCircle size={16} className="spin" aria-hidden="true" />{statusText || 'Starting your backup…'}</span>
        {runUrl && <a href={runUrl} target="_blank" rel="noreferrer">View progress ↗</a>}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setReviewOpen(true)}
        className="btn btn--secondary"
      >
        {refresh ? 'Update backup' : 'Back up now'}
      </button>
      <ActionDialog open={reviewOpen} onClose={() => setReviewOpen(false)} title={refresh ? 'Update your backup' : 'Back up your repository'} actions={<>
        <button type="button" className="btn btn--secondary" onClick={() => setReviewOpen(false)}>Not now</button>
        <button type="button" className="btn btn--primary" onClick={() => { setReviewOpen(false); handleBackup(); }}>{refresh ? 'Update backup' : 'Start backup'}</button>
      </>}>
        <p><strong>{repoFullName}</strong></p>
        <p>{refresh ? 'Save the latest Git history of this repository as a new backup.' : 'Save your repository’s Git history so you can recover it later.'}</p>
        <p>The backup is stored on IPFS, and a proof is recorded on CKB testnet. Rivet covers the backup fee. No wallet is needed.</p>
      </ActionDialog>
      <ActionDialog open={!!errorMsg} onClose={() => setErrorMsg(null)} title="Your backup needs attention">
        <p role="alert">{errorMsg}</p>
        {runUrl && <a href={runUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> View backup progress</a>}
      </ActionDialog>
    </>
  );
}
