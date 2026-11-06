'use client';
import { useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { useSession } from 'next-auth/react';
import { PassportCard } from './PassportCard';
import { RefreshButton } from './RefreshButton';
import { ActionDialog, HelpButton } from './ActionDialog';
import { CheckCircle2, Fingerprint, LoaderCircle } from 'lucide-react';
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [phase, setPhase] = useState<'wallet' | 'server' | null>(null);
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
          setPhase('wallet');
          const signed = await waitForManifestStep(signer.signTransaction(passport.transaction), 'wallet', 90000, controller.signal);
          approved.current = { sporeId: passport.sporeId, transaction: JSON.parse(signed.stringify()) };
        }
        signedTransaction = approved.current.transaction;
      }
      if (wallet.current !== signer) throw new Error('Reconnect the same verified JoyID wallet before continuing.');
      setPhase('server');
      setState(await waitForManifestStep(fetch('/api/user/passport', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: passport && passport.status !== 'building' ? 'submit' : 'prepare', signedTransaction }),
      }).then(read), 'server', 60000, controller.signal));
    } catch (failure) {
      controller.abort();
      setError(failure instanceof Error ? failure.message : 'Could not continue passport minting.');
    } finally { active.current = false; abort.current = null; setPhase(null); setBusy(false); onBusyChange(false); }
  }
  if (!state?.enabled && !state?.passport && !error) return null;
  const passport = state?.passport;
  const confirmed = passport?.status === 'confirmed';
  const status = confirmed ? 'Passport minted' : passport?.status === 'submitted' ? 'Confirming on testnet' : passport?.status === 'accepted' ? 'Saved for submission' : passport ? 'Ready to continue' : 'Not minted yet';
  return <section className={styles.manifest} aria-labelledby="passport-title">
    <div className={styles.heading}><span className={styles.sectionIcon}><Fingerprint size={20} aria-hidden="true" /></span><h3 id="passport-title">Developer passport</h3></div>
    <div className={styles.passportLayout}>
    <PassportCard compact verified={confirmed} username={session?.user?.name || undefined} sporeId={passport?.sporeId} status={status} explorerUrl={passport?.explorerUrl} />
    <div className={styles.passportInfo}>
    {!confirmed && <p className={styles.description}>Your developer identity, in a collectible you own.</p>}
    {confirmed && <span className={styles.success} role="status"><CheckCircle2 size={16} aria-hidden="true" /> Mint confirmed</span>}
    </div></div>
    {!verified && !confirmed && <p className={styles.description}>Connect your identity wallet to mint.</p>}
    {busy && !reviewOpen && <p role="status" className={styles.pending}><LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />{phase === 'wallet' ? 'Approve in the JoyID window…' : 'Preparing your passport…'}</p>}
    {error && !reviewOpen && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      {busy && !reviewOpen && <button type="button" className="btn btn--secondary" onClick={() => setReviewOpen(true)}>View progress</button>}
      {(state?.enabled || confirmed) && <button type="button" className={confirmed ? 'btn btn--secondary' : 'btn btn--primary'} disabled={busy || disabled || (!confirmed && !verified)} onClick={() => setReviewOpen(true)}>
        {confirmed ? 'View passport' : !passport ? 'Create passport' : 'Continue minting'}
      </button>}
      <RefreshButton label="Check status" disabled={busy || disabled} onRefresh={() => { setError(''); return refresh(); }} onError={failure => setError(failure.message)} />
    </div>
    <HelpButton title="What is a developer passport?">
      <p>Your Sovereign Passport is a Spore collectible on CKB, owned by your JoyID wallet. It records your verified identity and backup proofs at the time you mint it.</p>
      <p>Minting is optional. Your wallet supplies the CKB locked in the passport and pays the network fee. The review screen shows both amounts before you approve.</p>
      <p>The card is Rivet’s visual presentation. The on-chain passport stores identity data; its artwork is displayed by the app.</p>
    </HelpButton>
    <ActionDialog open={reviewOpen} onClose={() => setReviewOpen(false)} title={confirmed ? 'Your developer passport' : 'Create your developer passport'} actions={<>
      <button type="button" className="btn btn--secondary" onClick={() => setReviewOpen(false)}>{busy ? 'Hide progress' : confirmed ? 'Done' : 'Not now'}</button>
      {!confirmed && state?.enabled && <button type="button" className="btn btn--primary" disabled={busy || disabled || !verified || (!consent && (!passport || passport.status === 'prepared'))} onClick={act}>
        {busy ? phase === 'wallet' ? 'Waiting for JoyID…' : 'Preparing passport…' : !passport ? 'Prepare passport' : passport.status === 'building' ? 'Continue preparation' : passport.transaction ? 'Approve mint in JoyID' : 'Retry saved mint'}
      </button>}
    </>}>
      <p>{confirmed ? 'Your passport is confirmed on CKB testnet.' : 'Mint a public collectible for your verified developer identity. You own it through your JoyID wallet.'}</p>
      {passport ? <>
        <div className={styles.review}><strong>Locked capacity: {passport.capacityCKB} test CKB</strong><strong>Network fee: {passport.feeCKB} test CKB</strong><p>Paid by your JoyID wallet. Locked capacity is stored in the passport and is separate from the fee.</p></div>
        <p role="status">{status}</p>
        <details className={styles.details}><summary>Technical details</summary><p className={styles.commitment}>Spore ID: {passport.sporeId}</p><p className={styles.commitment}>Manifest at mint: {passport.manifestRoot}</p></details>
        {passport.explorerUrl && <a href={passport.explorerUrl} target="_blank" rel="noreferrer">View passport transaction ↗</a>}
      </> : <p>Your wallet funds the passport’s locked capacity and network fee. Prepare the mint to see the exact amounts before approving.</p>}
      {(!passport || passport.status === 'prepared') && <label className={styles.consent}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} /><span>Use my JoyID wallet’s test CKB to mint my public passport.</span></label>}
      {phase === 'wallet' && <p role="status">Open the JoyID window and approve with your passkey.</p>}
      {phase === 'server' && <p role="status">Checking and saving your passport transaction…</p>}
      {busy && <button type="button" className="btn btn--secondary" onClick={() => abort.current?.abort()}>Stop waiting</button>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </ActionDialog>
  </section>;
}
