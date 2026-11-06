import Link from 'next/link';
import { ShieldCheck, Database, FileCheck } from 'lucide-react';
import { ContentPage, EmptyState } from '@/components/ContentPage';
import styles from '@/components/ContentPage.module.css';
import { findPublicBackup, checkPublicBackupAnchor, type PublicBackup, type AnchorCheck } from '@/lib/public-backups';
import { VerifySearchClient } from './VerifySearchClient';

export const metadata = { title: 'Look up a backup · Rivet' };
export const dynamic = 'force-dynamic';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, 200) : '';
  let repository: PublicBackup | null = null;
  let anchor: AnchorCheck | null = null;
  let unavailable = false;
  if (query) {
    try { repository = await findPublicBackup(query); if (repository) anchor = await checkPublicBackupAnchor(repository); }
    catch { unavailable = true; }
  }

  return <ContentPage title="Find the proof behind a backup." description="Look up a public backup by CKB transaction hash, IPFS CID, or owner/repository. Rivet checks the saved reference against CKB testnet." actions={<Link href="/docs#verification" className="btn btn--secondary">How verification works</Link>}>
    <VerifySearchClient initialQuery={query} />
    {unavailable ? <EmptyState title="Backup lookup is temporarily unavailable"><p>Try again shortly. No verification result is available for this request.</p></EmptyState>
      : query && !repository ? <EmptyState title="No public backup found"><p>Check the full reference or try <strong>owner/repository</strong>. Private profiles and private repositories are not included in public searches.</p><Link href="/explore">Browse public backups →</Link></EmptyState>
      : repository && <section className={styles.section} aria-label="Backup lookup result">
        <article className={styles.card}><h2>{anchor?.status === 'confirmed' ? 'Backup anchor confirmed' : anchor?.status === 'pending' ? 'Backup found; confirmation pending' : anchor?.status === 'unavailable' ? 'Backup found; chain check unavailable' : 'Backup found; anchor needs review'}</h2><p>{anchor?.status === 'confirmed' ? 'The referenced transaction is committed on CKB testnet and contains the saved anchor output.' : anchor?.status === 'pending' ? 'The selected RPC has not returned a committed transaction for this reference.' : anchor?.status === 'unavailable' ? 'The CKB check could not finish. The saved backup record alone does not establish on-chain confirmation.' : 'The saved anchor reference could not be matched to a valid commitment output.'}</p>{anchor?.status === 'confirmed' && <span className={styles.status}><ShieldCheck size={16} aria-hidden="true" /> Confirmed on CKB testnet{anchor.blockHeight ? ` · Block ${anchor.blockHeight}` : ''}</span>}</article>
        <div className={styles.grid}>
          <article className={styles.card}><h3>Repository</h3><Link href={`/${repository.fullName}`}>{repository.fullName}</Link><p>{repository.commitCount} commits in the saved backup record.</p>{repository.ckbTxHash && <a href={`https://pudge.explorer.nervos.org/transaction/${repository.ckbTxHash}`} target="_blank" rel="noreferrer">View anchor transaction ↗</a>}</article>
          <article className={styles.card}><h3>Backup storage</h3><p className={styles.code}>{repository.lastBackupCid}</p><p>The saved bundle is stored through IPFS. Recovery may require your private recovery file; public lookup does not expose decryption keys.</p><Link href="/docs#restore">How to restore your own backup →</Link></article>
        </div>
        {anchor?.status === 'confirmed' && <details className={styles.details}><summary>Anchor commitment and verification scope</summary><div><p className={styles.code}>{anchor.root}</p><p>This check uses the selected testnet RPC to confirm the transaction and anchor output. Verifying the backup’s commit set also requires the exported recovery proof and bundle. Commit dates and current file availability are separate from anchor confirmation.</p></div></details>}
      </section>}
    <section className={styles.section}><h2>Choose the check you need</h2><div className={styles.grid}>
      <article className={styles.card}><Database size={24} aria-hidden="true" /><h3>Find a backup record</h3><p>Match a repository, transaction hash, or CID with a public saved backup.</p></article>
      <article className={styles.card}><ShieldCheck size={24} aria-hidden="true" /><h3>Check the chain anchor</h3><p>Confirm that the referenced transaction was committed and inspect its commitment output.</p></article>
      <article className={styles.card}><FileCheck size={24} aria-hidden="true" /><h3>Verify a bundle or identity</h3><p>Use the source CLI for backup bundle checks, or a developer profile and exported manifest for identity proofs.</p><Link href="/docs#verification">Open the verification guide →</Link></article>
    </div></section>
  </ContentPage>;
}
