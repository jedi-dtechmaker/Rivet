'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { Shield, Wallet } from 'lucide-react';
import { CotaManifest } from './CotaManifest';
import styles from './WalletIdentity.module.css';

type Registration = {
  address: string;
  status: string;
  txHash: string;
  explorerUrl: string;
};

type IdentityState = {
  address: string | null;
  verified: boolean;
  enabled: boolean;
  registration: Registration | null;
};

type RecordsUpdate = {
  id: string;
  status: string;
  protocol: string;
  blockedReason: string | null;
  root: string;
  cotaRoot: string;
  explorerUrl: string;
  records: { key: string; record: { kind: string; repository?: string } }[];
  transaction: ccc.TransactionLike | null;
  feeCKB: string;
};

async function readResponse(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not complete this request. Please retry.');
  return result;
}

export function WalletIdentity() {
  const { open, disconnect } = ccc.useCcc();
  const signer = ccc.useSigner();
  const [connectedAddress, setConnectedAddress] = useState('');
  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [identityStatusError, setIdentityStatusError] = useState('');
  const [recordsStatusError, setRecordsStatusError] = useState('');
  const [notice, setNotice] = useState('');
  const [recordsUpdate, setRecordsUpdate] = useState<RecordsUpdate | null>(null);
  const [manifestEnabled, setManifestEnabled] = useState(false);
  const identityRequest = useRef<Promise<void> | null>(null);
  const recordsRequest = useRef<Promise<void> | null>(null);
  const approvedProof = useRef<{ id: string; transaction: ccc.TransactionLike } | null>(null);

  const refresh = useCallback(() => {
    if (identityRequest.current) return identityRequest.current;
    identityRequest.current = Promise.all([
      fetch('/api/user/sync-wallet', { cache: 'no-store' }).then(readResponse),
      fetch('/api/user/cota', { cache: 'no-store' }).then(readResponse),
    ]).then(([wallet, cota]) => {
      setIdentity({ ...wallet, ...cota });
      setIdentityStatusError('');
    }).finally(() => { identityRequest.current = null; });
    return identityRequest.current;
  }, []);

  useEffect(() => {
    refresh().catch(failure => setIdentityStatusError(failure.message));
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setConnectedAddress('');
    setNotice('');
    if (signer) {
      signer.getRecommendedAddress().then(address => {
        if (!cancelled) setConnectedAddress(address);
      }).catch(() => { if (!cancelled) setError('Could not read the connected wallet.'); });
    }
    return () => { cancelled = true; };
  }, [signer]);

  const registrationStatus = identity?.registration?.status;
  const refreshRecords = useCallback(() => {
    if (recordsRequest.current) return recordsRequest.current;
    recordsRequest.current = fetch('/api/user/cota/records', { cache: 'no-store' }).then(readResponse)
      .then(result => { setRecordsUpdate(result.update); setRecordsStatusError(''); })
      .finally(() => { recordsRequest.current = null; });
    return recordsRequest.current;
  }, []);
  useEffect(() => {
    if (registrationStatus !== 'confirmed') return;
    refreshRecords().catch(failure => setRecordsStatusError(failure.message));
  }, [registrationStatus, refreshRecords]);
  useEffect(() => {
    if (recordsUpdate?.status !== 'submitted' && !(recordsUpdate?.status === 'prepared' && !recordsUpdate.transaction)) return;
    const timer = setInterval(() => refreshRecords().catch(failure => setRecordsStatusError(failure.message)), 10000);
    return () => clearInterval(timer);
  }, [recordsUpdate?.status, recordsUpdate?.transaction, refreshRecords]);
  useEffect(() => {
    if (registrationStatus !== 'prepared' && registrationStatus !== 'submitted') return;
    const timer = setInterval(() => {
      refresh().catch(failure => setIdentityStatusError(failure.message));
    }, 10000);
    return () => clearInterval(timer);
  }, [registrationStatus, refresh]);

  const verified = !!connectedAddress && identity?.verified && identity.address === connectedAddress;
  const isJoyId = signer?.signType === ccc.SignerSignType.JoyId && connectedAddress.startsWith('ckt1');
  const registered = !!identity?.registration;
  const pendingWitnessProof = recordsUpdate?.status === 'prepared' && recordsUpdate.protocol === 'rivet-witness-v1';

  async function chooseJoyId() {
    setBusy(true);
    setError('');
    try {
      await disconnect();
      open();
    } catch {
      setError('Could not open the wallet picker. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyWallet() {
    if (!signer) return;
    const challenge = await fetch('/api/user/sync-wallet/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ckbAddress: connectedAddress }),
    }).then(readResponse);
    const proof = await signer.signMessage(challenge.message);
    await fetch('/api/user/sync-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, proof }),
    }).then(readResponse);
  }

  async function activate() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!verified && !registered) await verifyWallet();
      if (identity?.enabled || registered) {
        const result = await fetch('/api/user/cota', { method: 'POST' }).then(readResponse);
        setIdentity(current => current ? { ...current, registration: result.registration } : current);
        setNotice(result.registration.status === 'confirmed' ? 'Your CoTA identity is active.' : 'Activation submitted. Waiting for testnet confirmation.');
      } else {
        setNotice('Wallet verified. Sponsored identity activation will be available once Rivet enables it.');
      }
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Activation did not finish. You can retry.');
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function syncRecords() {
    if (!signer || !verified || !isJoyId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (recordsUpdate?.status !== 'prepared' || recordsUpdate.protocol !== 'rivet-witness-v1') {
        const result = await fetch('/api/user/cota/records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare', protocol: 'rivet-witness-v1' }),
        }).then(readResponse);
        const update: RecordsUpdate = result.update;
        setRecordsUpdate(update);
        if (result.unchanged) setNotice('Your identity and backup proofs are already synchronized.');
        else if (update.status === 'confirmed') setNotice('Identity records confirmed. Sync again to include any newer backups.');
        else if (update.status === 'submitted') setNotice('Your identity update is awaiting testnet confirmation.');
        else if (update.status === 'rejected' || update.status === 'blocked') throw new Error(update.blockedReason || 'The identity update needs review before retrying.');
        else setNotice(`Signed proof prepared. Review the ${update.feeCKB} test CKB fee, then choose Review and approve in JoyID.`);
        return;
      }
      const update = recordsUpdate;
      if (update.transaction && approvedProof.current?.id !== update.id) {
        const signed = await signer.signTransaction(ccc.Transaction.from(update.transaction));
        approvedProof.current = { id: update.id, transaction: JSON.parse(signed.stringify()) };
      }
      const signed = approvedProof.current?.id === update.id ? approvedProof.current.transaction : null;
      const submitted = await fetch('/api/user/cota/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', id: update.id, ...(signed ? { transaction: signed } : {}) }),
      }).then(readResponse);
      setRecordsUpdate(submitted.update);
      setNotice(submitted.update.status === 'confirmed' ? 'Signed identity and backup proofs confirmed.' : 'Signed proofs submitted. Waiting for testnet confirmation.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not synchronize identity records.');
      await refreshRecords().catch(() => {});
    } finally { setBusy(false); }
  }

  return (
    <section id="identity" className={styles.card} aria-labelledby="identity-title">
      <div className={styles.heading}>
        <Shield size={22} aria-hidden="true" />
        <h2 id="identity-title">Your on-chain identity</h2>
        <span className={styles.badge}>Optional · Testnet</span>
      </div>
      <p className={styles.description}>Connect JoyID on CKB testnet, then choose Activate identity to verify wallet ownership and create your CoTA identity. Rivet sponsors activation. Your GitHub backups work without a wallet.</p>
      {connectedAddress && <p className={styles.address}>Connected wallet: {connectedAddress}</p>}
      {identity?.address && identity.address !== connectedAddress && (
        <p className={styles.address}>{identity.verified ? 'Identity wallet' : 'Previously saved wallet (verification required)'}: {identity.address}</p>
      )}
      {connectedAddress && !isJoyId && !registered && <p id="identity-wallet-help">Your connected wallet is not a CKB testnet JoyID wallet. Choose JoyID in the wallet picker to enable identity activation.</p>}
      {verified && !registered && <p>Wallet ownership verified.</p>}
      {identity?.registration && (
        <p role="status">
          {registrationStatus === 'confirmed' ? 'CoTA identity active.' : registrationStatus === 'rejected' ? 'Activation was rejected. Contact Rivet with the transaction below.' : 'Identity activation is awaiting confirmation.'}
          {' '}<a href={identity.registration.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>
        </p>
      )}
      {registrationStatus === 'confirmed' && (
        <>
          <CotaManifest signer={signer} verified={!!verified} isJoyId={!!isJoyId} disabled={busy} onBusyChange={setBusy} onEnabledChange={setManifestEnabled} />
          <details>
          <summary>Previous signed proof alternative</summary>
          <p>Signed proof anchoring publishes your developer identity and completed public backup proofs in an on-chain transaction approved by JoyID. It preserves your existing CoTA tree and does not store the records in its SMT. The records will be public on testnet. Review the prepared fee before approving; a fee below 0.01 test CKB comes from your existing identity cell.</p>
          {recordsUpdate && <p role="status">
            {recordsUpdate.status === 'blocked' ? recordsUpdate.blockedReason : recordsUpdate.status === 'confirmed' ? 'Signed identity and backup proofs confirmed.' : recordsUpdate.status === 'submitted' ? 'Signed proofs awaiting confirmation.' : recordsUpdate.status === 'rejected' ? 'Identity update rejected. Contact Rivet before retrying.' : 'Signed proof prepared. Review the fee before approving in JoyID.'}
            {(recordsUpdate.status === 'confirmed' || recordsUpdate.status === 'submitted') && <>{' '}<a href={recordsUpdate.explorerUrl} target="_blank" rel="noreferrer">View records transaction</a></>}
          </p>}
          {recordsUpdate?.protocol === 'rivet-witness-v1' && <>
            <p className={styles.address}>Record commitment: {recordsUpdate.root}</p>
            <p className={styles.address}>Preserved CoTA root: {recordsUpdate.cotaRoot}</p>
            <p>Transaction fee: {recordsUpdate.feeCKB} test CKB.</p>
            <p>Records: developer identity{recordsUpdate.records.filter(entry => entry.record.kind === 'backup').map(entry => `, ${entry.record.repository} backup`).join('')}.</p>
          </>}
          {recordsUpdate?.status === 'confirmed' && <p>{recordsUpdate.records.filter(entry => entry.record.kind === 'backup').length} public backup proof(s) committed.</p>}
          {recordsUpdate?.status === 'confirmed' && <a href="/api/user/cota/records" download="rivet-identity-proof.json">Download identity proof</a>}
          {connectedAddress && !verified && <p>Reconnect your verified identity wallet to update its records.</p>}
          {manifestEnabled && !pendingWitnessProof && <p>Use the CoTA manifest above for new records. Earlier signed proofs remain available here.</p>}
          {(!manifestEnabled || pendingWitnessProof) && <button type="button" className="btn btn--primary" disabled={busy || !verified || !isJoyId || recordsUpdate?.status === 'rejected' || recordsUpdate?.status === 'submitted'} onClick={syncRecords}>
            {busy ? 'Working…' : recordsUpdate?.status === 'prepared' && recordsUpdate.protocol === 'rivet-witness-v1' ? recordsUpdate.transaction && approvedProof.current?.id !== recordsUpdate.id ? 'Review and approve in JoyID' : 'Retry signed proof submission' : recordsUpdate?.status === 'confirmed' ? 'Sync signed identity proofs' : 'Prepare signed proof'}
          </button>}
          </details>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {(error || identityStatusError || recordsStatusError) && <p role="alert" className={styles.error}>{error || identityStatusError || recordsStatusError}</p>}
      <div className={styles.actions}>
        {!signer ? (
          <button type="button" className="btn btn--primary" onClick={() => open()}><Wallet size={16} /> Connect Wallet</button>
        ) : (
          <>
            {!registered && (
              <button type="button" className="btn btn--primary" aria-describedby={connectedAddress && !isJoyId ? 'identity-wallet-help' : undefined} disabled={busy || !identity || !isJoyId || (!!verified && !identity.enabled)} onClick={activate}>
                {busy ? 'Activating…' : identity?.enabled ? 'Activate identity' : 'Verify wallet ownership'}
              </button>
            )}
            {!registered && !isJoyId && <button type="button" className="btn btn--secondary" disabled={busy} onClick={chooseJoyId}>Choose JoyID wallet</button>}
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => disconnect()}>Disconnect Wallet</button>
          </>
        )}
        {registrationStatus === 'prepared' && <button type="button" className="btn btn--primary" disabled={busy} onClick={activate}>Retry activation</button>}
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setError(''); refresh().catch(failure => setError(failure.message)); }}>Refresh status</button>
      </div>
    </section>
  );
}
