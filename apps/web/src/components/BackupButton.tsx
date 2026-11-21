'use client';

import { useState, useRef, useEffect } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
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
  const [progress, setProgress] = useState(0);

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
      setProgress(0);

      // Start the private background worker. Returns immediately (202).
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
      const jobId = data.jobId;

      setStatusText('Waiting for a backup worker…');

      // 2. Poll until the worker reports back through /api/backup/callback.
      const startedAt = Date.now();

      pollRef.current = setInterval(async () => {
        if (cancelledRef.current) return;

        try {
          const s = await fetch(
            `/api/backup/status?repoFullName=${encodeURIComponent(repoFullName)}&since=${encodeURIComponent(since)}&jobId=${encodeURIComponent(jobId)}`,
            { cache: 'no-store' },
          );
          const sd = await s.json().catch(() => ({}));

          if (!s.ok) throw new Error('Progress is temporarily unavailable.');
          setProgress(current => Math.max(current, Number(sd.percent) || 0));
          setStatusText(sd.label || 'Waiting for a backup worker…');

          if (sd.status === 'failed') {
            stopPolling();
            setStatus('idle');
            setErrorMsg('Your backup was interrupted before its proof was prepared. Please try again.');
            return;
          }

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
              'Your backup is taking longer than expected. Check this repository again later; it may still complete.',
            );
            return;
          }

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
        <div className={styles.progressTrack} role="progressbar" aria-label="Estimated backup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% — ${statusText}`}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.note}>{progress}% · Estimated from completed stages</span>
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
      </ActionDialog>
    </>
  );
}
