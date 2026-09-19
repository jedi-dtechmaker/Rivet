'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { syncGitHubRepos } from './actions';

export function SyncButtonClient() {
  const [isPending, startTransition] = useTransition();

  const handleSync = () => {
    startTransition(() => {
      syncGitHubRepos();
    });
  };

  return (
    <button className="btn btn--secondary" onClick={handleSync} disabled={isPending}>
      <RefreshCw size={16} className={isPending ? 'spin' : ''} /> 
      {isPending ? 'Syncing...' : 'Sync GitHub'}
    </button>
  );
}
