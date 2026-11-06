'use client';
import { useEffect, useState } from 'react';
import styles from './CotaManifest.module.css';
import { PassportCard } from './PassportCard';
import { ActionDialog, HelpButton } from './ActionDialog';
import { CheckCircle2 } from 'lucide-react';
type Identity = { passportStatus?: string | null; manifest: { manifestRoot: string; manifestTxHash: string; backupCount: number; verifiedAnchorCount: number };
  passport: null | { sporeId: string; ownedByLinkedWallet: boolean; live: boolean; explorerUrl: string; manifestRoot: string } };
export function PublicIdentity({ username }: { username: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null), [status, setStatus] = useState('Checking public identity on CKB testnet…');
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setIdentity(null);
    setStatus('Checking developer identity…');
    fetch(`/api/profile/${encodeURIComponent(username)}/proof`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 404) { setStatus('No public identity shared yet.'); return; }
        if (!response.ok) throw new Error();
        setIdentity(await response.json()); setStatus('');
      }).catch(() => { if (!controller.signal.aborted) setStatus('Identity verification is unavailable. Please retry later.'); });
    return () => controller.abort();
  }, [username]);
  return <section className={styles.publicPanel} aria-labelledby="public-identity-title">
    <div className={styles.panelHeading}><h2 id="public-identity-title">Developer passport</h2>
      {identity && <span className={styles.success}><CheckCircle2 size={16} aria-hidden="true" /> Identity verified</span>}
    </div>
    {status && <p role="status">{status}</p>}
    {identity && <>
      <div className={styles.passportLayout}>
      {identity.passport && <PassportCard verified={identity.passport.ownedByLinkedWallet} username={username} sporeId={identity.passport.sporeId} explorerUrl={identity.passport.explorerUrl}
        status={identity.passport.ownedByLinkedWallet ? 'Owned by linked JoyID wallet' : identity.passport.live ? 'Ownership changed' : 'No longer live'} />}
      <div className={styles.passportInfo}>
      <h3>{identity.passport ? 'An identity you own.' : 'Your work, anchored on CKB.'}</h3>
      <div className={styles.stats}>
        <span className={styles.stat}><strong>{identity.manifest.backupCount}</strong>Backup proofs</span>
        <span className={styles.stat}><strong>{identity.manifest.verifiedAnchorCount}</strong>Backups verified</span>
      </div>
      <div className={styles.actions}><button type="button" className="btn btn--secondary" onClick={() => setDetailsOpen(true)}>View verification</button></div>
      {identity.passportStatus === 'unavailable' && <p>Passport confirmation or current ownership could not be verified. Please retry later.</p>}
      </div></div>
      <HelpButton title="What has been verified?">
        <p>Rivet checks a confirmed snapshot of this developer’s identity and public backup proofs against its trusted issuer and a CKB testnet RPC.</p>
        <p>The snapshot records the proofs checked at that point. It does not establish that there is no newer update or that backup files are currently available on IPFS.</p>
        <p>Blockchain anchors show that a repository commitment existed by a block checkpoint. They do not certify the dates entered in Git commits.</p>
      </HelpButton>
      <ActionDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Identity verification">
      <div className={styles.manifest}>
      <h3>Verified backup proof snapshot</h3>
      <p className={styles.commitment}>{identity.manifest.manifestRoot}</p>
      <p><a href={`https://pudge.explorer.nervos.org/transaction/${identity.manifest.manifestTxHash}`} target="_blank" rel="noreferrer">View manifest transaction</a></p>
      <p><a href={`/api/profile/${encodeURIComponent(username)}/proof`} target="_blank" rel="noreferrer">View verification and proof references</a></p>
      {identity.passport && <>
        <h3>Sovereign Passport · Spore DOB</h3>
        <p>{identity.passport.ownedByLinkedWallet ? 'Currently owned by the linked JoyID wallet.' : identity.passport.live ? 'Passport ownership has changed.' : 'Passport is no longer live.'}</p>
        <p className={styles.commitment}>Spore ID: {identity.passport.sporeId}</p>
        <p className={styles.commitment}>Manifest at mint: {identity.passport.manifestRoot}</p>
        <a href={identity.passport.explorerUrl} target="_blank" rel="noreferrer">View passport mint</a>
      </>}
      <p>This verifies the referenced snapshot. Current file availability and whether a newer identity update exists are separate checks.</p>
      </div></ActionDialog>
    </>}
  </section>;
}
