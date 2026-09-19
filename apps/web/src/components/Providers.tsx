'use client';

import React from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { SessionProvider } from 'next-auth/react';
import { SidebarProvider } from '@/contexts/SidebarContext';

export function Providers({ children }: { children: React.ReactNode }) {
  // Ensure we are explicitly using the CKB Testnet
  const client = new ccc.ClientPublicTestnet();
  
  return (
    <SessionProvider>
      {/* @ts-expect-error client prop is valid at runtime */}
      <ccc.Provider client={client}>
        <SidebarProvider>
          {children}
        </SidebarProvider>
      </ccc.Provider>
    </SessionProvider>
  );
}
