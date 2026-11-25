'use client';

import React, { useMemo } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { AnalyticsTracker } from '@/components/AnalyticsTracker';

export function Providers({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  // Ensure we are explicitly using the CKB Testnet
  const client = useMemo(() => new ccc.ClientPublicTestnet(), []);
  
  return (
    <SessionProvider session={session}>
      <ccc.Provider defaultClient={client} name="Rivet">
        <SidebarProvider>
          <AnalyticsTracker />
          {children}
        </SidebarProvider>
      </ccc.Provider>
    </SessionProvider>
  );
}
