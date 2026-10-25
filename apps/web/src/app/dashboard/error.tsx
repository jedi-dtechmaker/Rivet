'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function DashboardError({ reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert" style={{ padding: 'var(--space-6)', display: 'grid', gap: 'var(--space-4)', maxWidth: '42rem', margin: '4rem auto' }}>
      <AlertCircle size={36} aria-hidden="true" />
      <h1>Dashboard temporarily unavailable</h1>
      <p>We couldn’t load your saved backup status. Please try again.</p>
      <div>
        <button type="button" className="btn btn--primary" onClick={reset}>
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
      </div>
    </section>
  );
}
