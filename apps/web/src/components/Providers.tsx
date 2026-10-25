'use client';

import React, { useMemo } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { SessionProvider } from 'next-auth/react';
import { SidebarProvider } from '@/contexts/SidebarContext';

export function Providers({ children }: { children: React.ReactNode }) {
  // Ensure we are explicitly using the CKB Testnet
  const client = useMemo(() => new ccc.ClientPublicTestnet(), []);
  
  return (
    <SessionProvider>
      <ccc.Provider defaultClient={client} name="Rivet">
        <SidebarProvider>
          {children}
        </SidebarProvider>
      </ccc.Provider>
    </SessionProvider>
  );
}
