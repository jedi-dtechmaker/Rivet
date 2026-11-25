'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackedPage } from '@/lib/analytics-policy';

export function AnalyticsTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    const page = trackedPage(pathname);
    if (!page) return;
    void fetch('/api/analytics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page }), keepalive: true,
    }).catch(() => {});
  }, [pathname]);
  return null;
}
