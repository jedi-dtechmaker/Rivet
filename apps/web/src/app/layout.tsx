import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Providers } from '@/components/Providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Rivet — Your Code. Your Keys. Your Proof. Forever.',
  description:
    'Rivet is a decentralized developer platform that backs up, timestamps, and restores your entire GitHub history using CKB blockchain. Never lose your code, commits, or reputation again.',
  keywords: [
    'decentralized',
    'code hosting',
    'GitHub backup',
    'CKB',
    'RGB++',
    'blockchain',
    'developer tools',
    'code ownership',
  ],
  openGraph: {
    title: 'Rivet — Provable Repository of Open & Onchain Files',
    description: 'Back up, timestamp, and restore your GitHub history. Powered by CKB blockchain.',
    type: 'website',
  },
};

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Sidebar } from '@/components/Sidebar';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <Header />
          <div style={{ display: 'flex', paddingTop: 'var(--header-height)' }}>
            <Sidebar />
            <main style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
