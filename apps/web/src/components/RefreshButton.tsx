'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';
import styles from './RefreshButton.module.css';

type Props = {
  onRefresh: () => Promise<unknown>;
  onError: (error: Error) => void;
  disabled?: boolean;
  label?: string;
};

export function RefreshButton({ onRefresh, onError, disabled, label = 'Refresh' }: Props) {
  const [status, setStatus] = useState<'idle' | 'refreshing' | 'updated' | 'failed'>('idle');
  const active = useRef(false);

  useEffect(() => {
    if (status !== 'updated' && status !== 'failed') return;
    const timer = setTimeout(() => setStatus('idle'), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  async function refresh() {
    if (active.current || disabled) return;
    active.current = true;
    setStatus('refreshing');
    try {
      await onRefresh();
      setStatus('updated');
    } catch (error) {
      setStatus('failed');
      onError(error instanceof Error ? error : new Error('Could not refresh. Please retry.'));
    } finally {
      active.current = false;
    }
  }

  const refreshing = status === 'refreshing';
  return <button type="button" className={'btn btn--secondary ' + styles.button}
    disabled={disabled || refreshing} aria-busy={refreshing} onClick={refresh}>
    {refreshing ? <LoaderCircle size={14} className={styles.spinner} aria-hidden="true" />
      : status === 'updated' ? <Check size={14} className={styles.success} aria-hidden="true" />
        : <RefreshCw size={14} aria-hidden="true" />}
    <span role="status" aria-live="polite">{refreshing ? 'Refreshing…' : status === 'updated' ? 'Updated' : status === 'failed' ? 'Refresh failed · Retry' : label}</span>
  </button>;
}
