'use client';
import { useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { useSession } from 'next-auth/react';
import { PassportCard } from './PassportCard';
import { RefreshButton } from './RefreshButton';
import { waitForManifestStep } from '@/lib/cota-manifest-wait';
import styles from './CotaManifest.module.css';
type State = { enabled: boolean; passport: null | { status: string; sporeId: string; transaction: ccc.TransactionLike | null;
  capacityCKB: string; feeCKB: string; explorerUrl: string; manifestRoot: string } };
async function read(response: Response): Promise<State> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Could not load passport.');
  return value;
}
export function SovereignPassport({ signer, verified, disabled, onBusyChange }: {
  signer: ReturnType<typeof ccc.useSigner>; verified: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const { data: session } = useSession();
  const version = useRef(0);
  const active = useRef(false), abort = useRef<AbortController | null>(null);
  const wallet = useRef(signer); wallet.current = signer;
  const approved = useRef<{ sporeId: string; transaction: ccc.TransactionLike } | null>(null);
  const refresh = () => {
    const requestVersion = version.current;
    return fetch('/api/user/passport', { cache: 'no-store', signal: AbortSignal.timeout(30000) }).then(read).then(result => {
      if (requestVersion === version.current) { setState(result); setError(''); }
    });
  };
  useEffect(() => { refresh().catch(failure => setError(failure.message)); return () => abort.current?.abort(); }, []);
  useEffect(() => { if (signer && verified) refresh().catch(failure => setError(failure.message)); }, [signer, verified]);
  useEffect(() => {
    if (!['accepted', 'submitted'].includes(state?.passport?.status || '')) return;
    const timer = setInterval(() => { if (!active.current) refresh().catch(failure => setError(failure.message)); }, 10000);
    return () => clearInterval(timer);
  }, [state?.passport?.status]);
  async function act() {
    if (active.current || disabled || !verified || !signer || ((!state?.passport || state.passport.status === 'prepared') && !consent)) return;
    active.current = true; version.current++; setBusy(true); onBusyChange(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      const passport = state?.passport;
      let signedTransaction;
      if (passport?.transaction) {
        if (approved.current?.sporeId !== passport.sporeId) {
          const signed = await waitForManifestStep(signer.signTransaction(passport.transaction), 'wallet', 90000, controller.signal);
          approved.current = { sporeId: passport.sporeId, transaction: JSON.parse(signed.stringify()) };
        }
        signedTransaction = approved.current.transaction;
      }
      if (wallet.current !== signer) throw new Error('Reconnect the same verified JoyID wallet before continuing.');
      setState(await waitForManifestStep(fetch('/api/user/passport', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: passport && passport.status !== 'building' ? 'submit' : 'prepare', signedTransaction }),
      }).then(read), 'server', 60000, controller.signal));
    } catch (failure) {
      controller.abort();
      setError(failure instanceof Error ? failure.message : 'Could not continue passport minting.');
    } finally { active.current = false; abort.current = null; setBusy(false); onBusyChange(false); }
  }
  if (!state?.enabled && !state?.passport && !error) return null;
  const passport = state?.passport;
  return <section className={styles.manifest} aria-labelledby="passport-title">
    <h3 id="passport-title">Sovereign Passport</h3>
    <div className={styles.passportLayout}>
    <PassportCard username={session?.user?.name || undefined} sporeId={passport?.sporeId} status={passport?.status === 'confirmed' ? 'Mint confirmed on CKB' : passport ? `Mint ${passport.status}` : 'Ready to make yours'} explorerUrl={passport?.explorerUrl} />
    <div className={styles.passportInfo}>
    {passport?.status !== 'confirmed' && <p className={styles.description}>Mint your developer passport to JoyID.</p>}
    {passport && <details className={styles.details}><summary>Passport details & transaction</summary><div className={styles.review}>
      <p role="status">Passport: {passport.status}.</p>
      <p className={styles.commitment}>Spore ID: {passport.sporeId}</p>
      <p>Locked capacity: {passport.capacityCKB} test CKB. Network fee: {passport.feeCKB} test CKB.</p>
      <p className={styles.commitment}>Manifest at mint: {passport.manifestRoot}</p>
      {passport.explorerUrl && <a href={passport.explorerUrl} target="_blank" rel="noreferrer">View passport transaction</a>}
      {passport.status === 'confirmed' && <RefreshButton label="Refresh status" disabled={busy || disabled} onRefresh={() => { setError(''); return refresh(); }} onError={failure => setError(failure.message)} />}
    </div></details>}
    </div></div>
    {(!passport || passport.status === 'prepared') && <label className={styles.consent}>
      <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
      <span>Use my JoyID wallet’s test CKB to mint my public passport. I will review the capacity and fee before approving.</span>
    </label>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      {state?.enabled && passport?.status !== 'confirmed' && <button className="btn btn--primary" disabled={busy || disabled || !verified || (!consent && (!passport || passport.status === 'prepared'))} onClick={act}>
        {busy ? 'Waiting for passport…' : !passport ? 'Prepare passport mint' : passport.status === 'building' ? 'Continue preparation' : passport.transaction ? 'Review and mint in JoyID' : 'Retry saved mint'}
      </button>}
      {busy && <button className="btn btn--secondary" onClick={() => abort.current?.abort()}>Stop waiting</button>}
      {passport?.status !== 'confirmed' && <RefreshButton label="Refresh passport status" disabled={busy || disabled} onRefresh={() => { setError(''); return refresh(); }} onError={failure => setError(failure.message)} />}
    </div>
  </section>;
}
