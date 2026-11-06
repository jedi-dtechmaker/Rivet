'use client';

import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HelpButton } from './ActionDialog';
import styles from './AutoSyncToggle.module.css';

export function AutoSyncToggle({ initialAutoSync }: { initialAutoSync: boolean }) {
  const [isAutoSync, setIsAutoSync] = useState(initialAutoSync);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleToggle = async () => {
    setIsPending(true);
    setError('');
    const newValue = !isAutoSync;
    setIsAutoSync(newValue); // Optimistic UI update

    try {
      const res = await fetch('/api/user/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSync: newValue })
      });

      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || 'Failed to update Auto-Sync setting');
      }
      
      router.refresh();
    } catch (e) {
      console.error(e);
      setIsAutoSync(!newValue); // Revert on failure
      setError(e instanceof Error ? e.message : 'Could not update Auto Sync.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={styles.container}>
      <button type="button" role="switch" aria-checked={isAutoSync} aria-label="Auto-backup" aria-busy={isPending} disabled={isPending} onClick={handleToggle} className={`${styles.toggle} ${isAutoSync ? styles.active : ''}`}>
        <span className={styles.track} aria-hidden="true"><span /></span>
        Auto-backup <span className={styles.state}>{isAutoSync ? 'On' : 'Off'}</span>
        {isPending && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
      </button>
      <HelpButton title="Automatic backups" label="About auto-backup">
        <p>When enabled, Rivet starts a backup when it receives a GitHub push event for one of your repositories.</p>
        <p>You can still select <strong>Back up now</strong> or <strong>Update backup</strong> on an individual repository. Private repository backups are unavailable on testnet.</p>
      </HelpButton>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
