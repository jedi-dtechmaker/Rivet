import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { Fingerprint } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { WalletIdentity } from '@/components/WalletIdentity';
import { VellumIdentity } from '@/components/VellumIdentity';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Developer identity · Rivet' };

export default async function DeveloperIdentityPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=%2Fdashboard%2Fidentity');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Your workspace <span>/</span> Identity
          </p>
          <h1>Developer identity</h1>
          <p className={styles.description}>
            Your wallet, your backup proofs, your developer passport. All in one place.
          </p>
        </div>
        <div className={styles.emblem} aria-hidden="true">
          <Fingerprint size={48} strokeWidth={1.2} />
        </div>
      </header>
      <div className={styles.note}>
        <span className={styles.dot} />
        <p>
          <strong>Make it yours.</strong> Identity is optional. Your repository backups work without a wallet.
        </p>
        <span className={styles.network}>CKB testnet</span>
      </div>
      <WalletIdentity />
      <VellumIdentity />
    </div>
  );
}
