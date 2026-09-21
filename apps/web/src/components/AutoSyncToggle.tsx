'use client';

import { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function AutoSyncToggle({ initialAutoSync }: { initialAutoSync: boolean }) {
  const [isAutoSync, setIsAutoSync] = useState(initialAutoSync);
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  const handleToggle = async () => {
    setIsPending(true);
    const newValue = !isAutoSync;
    setIsAutoSync(newValue); // Optimistic UI update

    try {
      const res = await fetch('/api/user/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSync: newValue })
      });

      if (!res.ok) {
        throw new Error('Failed to update Auto-Sync setting');
      }
      
      router.refresh();
    } catch (e) {
      console.error(e);
      setIsAutoSync(!newValue); // Revert on failure
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <label 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          cursor: isPending ? 'not-allowed' : 'pointer',
          opacity: isPending ? 0.7 : 1,
          color: isAutoSync ? 'var(--color-primary)' : 'var(--color-text-dim)',
          fontSize: '14px',
          fontWeight: 500,
          background: isAutoSync ? 'rgba(255, 107, 0, 0.1)' : 'transparent',
          padding: '6px 12px',
          borderRadius: '8px',
          border: `1px solid ${isAutoSync ? 'var(--color-primary)' : 'var(--color-border)'}`,
          transition: 'all 0.2s ease'
        }}
      >
        <div style={{ position: 'relative', width: '32px', height: '18px', background: isAutoSync ? 'var(--color-primary)' : 'var(--color-border)', borderRadius: '18px', transition: 'background 0.2s ease' }}>
          <div style={{ position: 'absolute', top: '2px', left: isAutoSync ? '16px' : '2px', width: '14px', height: '14px', background: 'var(--color-surface)', borderRadius: '50%', transition: 'left 0.2s ease' }} />
        </div>
        <input 
          type="checkbox" 
          checked={isAutoSync} 
          onChange={handleToggle} 
          disabled={isPending}
          style={{ display: 'none' }}
        />
        {isAutoSync ? 'Auto-Sync Active' : 'Auto-Sync Off'}
        {isPending && <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />}
      </label>
    </div>
  );
}
