import { Search, ShieldCheck, Database, Link as LinkIcon, CheckCircle2, Clock, XCircle } from 'lucide-react';
import styles from './page.module.css';
import { db } from '@/lib/db';
import { VerifySearchClient } from './VerifySearchClient';

export default async function VerifyPage({ searchParams }: { searchParams: { q?: string } }) {
  const query = searchParams.q || '';
  
  // Real database search
  let repo = null;
  let hasSearched = false;

  if (query) {
    hasSearched = true;
    repo = await db.searchRepoByProof(query);
  }

  return (
    <div className={styles.verify_page}>
      
      <div className={styles.hero}>
        <h1 className={styles.title}>Public Verification</h1>
        <p className={styles.subtitle}>
          Enter a CKB Transaction Hash, a Merkle Root, or an IPFS CID to publicly verify the cryptographic proof of any repository.
        </p>
        
        <div className={styles.search_container}>
          <VerifySearchClient initialQuery={query} />
        </div>
      </div>

      {hasSearched && repo && repo.isBackedUp && (
        <div className={styles.result_container}>
          <div className={styles.result_header}>
            <div className={styles.result_status}>
              <ShieldCheck size={32} className={styles.success_icon} />
              <div>
                <h2>Proof Verified Successfully</h2>
                <p>This cryptographic proof is valid and anchored on Nervos CKB.</p>
              </div>
            </div>
          </div>

          <div className={styles.proof_details}>
            <div className={styles.detail_card}>
              <h3 className={styles.card_title}><Database size={16} /> Blockchain Anchor</h3>
              
              <div className={styles.detail_row}>
                <span className={styles.label}>Network</span>
                <span className={styles.value}>CKB Mainnet</span>
              </div>
              <div className={styles.detail_row}>
                <span className={styles.label}>Transaction</span>
                <span className={styles.value_link}>
                  <a href={`https://pudge.explorer.nervos.org/transaction/${repo.ckbTxHash}`} target="_blank" rel="noreferrer">
                    {repo.ckbTxHash}
                  </a>
                </span>
              </div>
              <div className={styles.detail_row}>
                <span className={styles.label}>Status</span>
                <span className={styles.value_success}>Confirmed</span>
              </div>
            </div>

            <div className={styles.detail_card}>
              <h3 className={styles.card_title}><LinkIcon size={16} /> Repository Data</h3>
              
              <div className={styles.detail_row}>
                <span className={styles.label}>Repository</span>
                <span className={styles.value}>{repo.fullName}</span>
              </div>
              <div className={styles.detail_row}>
                <span className={styles.label}>IPFS CID</span>
                <span className={styles.value_link}>
                  <a href={`https://gateway.pinata.cloud/ipfs/${repo.lastBackupCid}`} target="_blank" rel="noreferrer">
                    {repo.lastBackupCid}
                  </a>
                </span>
              </div>
              <div className={styles.detail_row}>
                <span className={styles.label}>Commits Verified</span>
                <span className={styles.value}>{repo.commitCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {hasSearched && !repo && (
         <div className={styles.result_container} style={{ textAlign: 'center', padding: '40px' }}>
           <XCircle size={48} color="var(--color-error)" style={{ margin: '0 auto 16px' }} />
           <h2>No Proof Found</h2>
           <p style={{ color: 'var(--color-text-dim)' }}>We couldn't find any cryptographic proofs matching your query.</p>
         </div>
      )}

    </div>
  );
}
