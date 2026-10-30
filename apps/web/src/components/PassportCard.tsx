import { Fingerprint, ShieldCheck, ArrowUpRight } from 'lucide-react';
import styles from './PassportCard.module.css';

export function PassportCard({ username, sporeId, status, explorerUrl }: {
  username?: string; sporeId?: string; status: string; explorerUrl?: string;
}) {
  return <div className={styles.card}>
    <div className={styles.top}><span>RIVET / PASSPORT</span><span className={styles.network}>CKB TESTNET</span></div>
    <div className={styles.art} aria-hidden="true">
      <div className={styles.orbit} /><div className={styles.orbitInner} />
      <div className={styles.emblem}><Fingerprint strokeWidth={1} size={96} /></div>
      <span className={styles.artLabel}>IDENTITY · OWNERSHIP · PROVENANCE</span>
    </div>
    <div className={styles.identity}><span className={styles.eyebrow}>SOVEREIGN DEVELOPER</span>
      <strong>{username || 'Your developer identity'}</strong>
      <span className={styles.status}><ShieldCheck size={14} aria-hidden="true" />{status}</span>
    </div>
    <div className={styles.bottom}>
      <span title={sporeId}>{sporeId ? `SPORE / ${sporeId.slice(2, 10)}…${sporeId.slice(-6)}` : 'SPORE / NOT MINTED'}</span>
      {explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer" aria-label="View passport on CKB explorer"><ArrowUpRight size={18} /></a>}
    </div>
  </div>;
}
