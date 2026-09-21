'use client';

import { useState, useRef, useEffect } from 'react';
import { RefreshCw, ShieldCheck, X, AlertTriangle, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 15 * 60 * 1000;

export function BackupButton({ repoFullName, isPrivate = false }: { repoFullName: string, isPrivate?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'backing_up' | 'backed_up'>('idle');
  const [progress, setProgress] = useState(0);
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
    cancelledRef.current = false;
    stopPolling();

    try {
      setStatus('backing_up');
      setProgress(5);
      setStatusText('Queueing backup worker...');
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

      setStatusText('Running on GitHub Actions...');
      setProgress(15);

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
            setProgress(100);
            setStatusText('Anchored');
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

          // The job is remote, so progress is indicative rather than exact.
          setProgress((p) => (p < 85 ? p + 5 : 85));
          setStatusText('Backing up on GitHub Actions...');
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

  if (status === 'backed_up') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span className="badge badge--success" style={{ padding: '4px 8px' }}>
          <ShieldCheck size={12} /> Anchored
        </span>
        {txHash && (
          <a
            href={`https://pudge.explorer.nervos.org/transaction/${txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '10px', color: 'var(--color-primary)' }}
          >
            View TX
          </a>
        )}
      </div>
    );
  }

  if (status === 'backing_up') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '150px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--color-text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
            <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            {statusText || 'Initializing...'}
          </span>
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{progress}%</span>
        </div>
        <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            backgroundColor: 'var(--color-primary)',
            transition: 'width 0.3s ease',
            boxShadow: '0 0 8px var(--color-primary)'
          }} />
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleBackup}
        className="btn btn--secondary"
        style={{ padding: '4px 12px', fontSize: '12px' }}
      >
        Backup Now
      </button>

      {/* Premium Error Modal Overlay */}
      {errorMsg && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '400px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)', position: 'relative'
          }}>
            <button
              onClick={() => setErrorMsg(null)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', color: '#ff4d4f' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text)' }}>Action Required</h3>
            </div>
            <p style={{ color: 'var(--color-text-dim)', lineHeight: 1.5, margin: 0, marginBottom: '24px' }}>
              {errorMsg}
            </p>
            {runUrl && (
              <a
                href={runUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-primary)', marginBottom: '16px' }}
              >
                <ExternalLink size={12} /> View workflow run
              </a>
            )}
            <button
              onClick={() => setErrorMsg(null)}
              className="btn btn--primary" style={{ width: '100%', justifyContent: 'center' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
