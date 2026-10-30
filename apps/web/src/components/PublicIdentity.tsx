'use client';
import { useEffect, useState } from 'react';
import styles from './CotaManifest.module.css';
import { PassportCard } from './PassportCard';
type Identity = { passportStatus?: string | null; manifest: { manifestRoot: string; manifestTxHash: string; backupCount: number; verifiedAnchorCount: number };
  passport: null | { sporeId: string; ownedByLinkedWallet: boolean; live: boolean; explorerUrl: string; manifestRoot: string } };
export function PublicIdentity({ username }: { username: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null), [status, setStatus] = useState('Checking public identity on CKB testnet…');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/profile/${encodeURIComponent(username)}/proof`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 404) { setStatus('No public CoTA manifest is available yet.'); return; }
        if (!response.ok) throw new Error();
        setIdentity(await response.json()); setStatus('');
      }).catch(() => { if (!controller.signal.aborted) setStatus('Identity verification is unavailable. Please retry later.'); });
    return () => controller.abort();
  }, [username]);
  return <section className={styles.publicPanel} aria-labelledby="public-identity-title">
    <h2 id="public-identity-title">Developer passport</h2>
    {status && <p role="status">{status}</p>}
    {identity && <>
      <div className={styles.passportLayout}>
      {identity.passport && <PassportCard username={username} sporeId={identity.passport.sporeId} explorerUrl={identity.passport.explorerUrl}
        status={identity.passport.ownedByLinkedWallet ? 'Owned by linked JoyID wallet' : identity.passport.live ? 'Ownership changed' : 'No longer live'} />}
      <div className={styles.passportInfo}>
      <h3>{identity.passport ? 'An identity you own.' : 'Your work, anchored on CKB.'}</h3>
      <p className={styles.description}>A verified snapshot of this developer’s identity and public backup proofs.</p>
      <div className={styles.stats}>
        <span className={styles.stat}><strong>{identity.manifest.backupCount}</strong>Public backup proofs</span>
        <span className={styles.stat}><strong>{identity.manifest.verifiedAnchorCount}</strong>Anchors verified</span>
      </div>
      <a href={`https://pudge.explorer.nervos.org/transaction/${identity.manifest.manifestTxHash}`} target="_blank" rel="noreferrer">View verified manifest ↗</a>
      {identity.passportStatus === 'unavailable' && <p>Passport confirmation or current ownership could not be verified. Please retry later.</p>}
      </div></div>
      <details className={styles.details}><summary>On-chain details & verification</summary>
      <div className={styles.manifest}>
      <h3>Verified CoTA manifest snapshot</h3>
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
      <p>Verification checks a confirmed snapshot against the configured trusted Rivet issuer and selected testnet RPC. It does not establish the newest CoTA state or verify backup file availability. Repository anchors prove existence by block height; they do not prove commit timestamps are truthful.</p>
      </div></details>
    </>}
  </section>;
}
