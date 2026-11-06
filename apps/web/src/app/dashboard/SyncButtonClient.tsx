'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { syncGitHubRepos } from './actions';

export function SyncButtonClient() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const handleSync = () => {
    setError('');
    startTransition(async () => {
      try { await syncGitHubRepos(); }
      catch { setError('Could not refresh repositories. Please retry.'); }
    });
  };

  return (
    <div><button type="button" className="btn btn--secondary" onClick={handleSync} disabled={isPending} aria-busy={isPending}>
      <RefreshCw size={16} className={isPending ? 'spin' : ''} /> 
      {isPending ? 'Refreshing…' : 'Refresh repositories'}
    </button>{error && <p role="alert">{error}</p>}</div>
  );
}
