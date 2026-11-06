'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { CheckCircle2, ShieldCheck, LoaderCircle } from 'lucide-react';
import { ActionDialog, HelpButton } from './ActionDialog';
import styles from './CotaManifest.module.css';
import { RefreshButton } from './RefreshButton';
import { ManifestWaitError, waitForManifestStep } from '@/lib/cota-manifest-wait';

type ManifestOperation = {
  id: string;
  kind: 'issue' | 'claim' | 'update';
  status: 'prepared' | 'accepted' | 'submitted' | 'confirmed' | 'blocked' | 'rejected';
  transaction?: ccc.TransactionLike | null;
  feeCKB?: string;
  root?: string | null;
  explorerUrl?: string | null;
  error?: string | null;
};

type ManifestState = {
  enabled: boolean;
  nextStep: 'issue' | 'claim' | 'update' | 'wait' | 'ready' | 'blocked';
  operation: ManifestOperation | null;
  confirmed?: { root: string; backupCount: number; explorerUrl?: string | null; exportUrl?: string | null } | null;
  latest?: { root?: string | null; backupCount: number } | null;
  hasChanges?: boolean;
  error?: string | null;
};

type Props = {
  signer: ReturnType<typeof ccc.useSigner>;
  verified: boolean;
  isJoyId: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onEnabledChange?: (enabled: boolean) => void;
};

async function readManifest(response: Response): Promise<ManifestState> {
  const result = await response.json();
  if (!response.ok) {
    const failure = new Error(result.error || 'Could not load your CoTA manifest. Please retry.') as Error & { code?: string };
    if (typeof result.code === 'string') failure.code = result.code;
    throw failure;
  }
  return result;
}

function operationMessage(operation: ManifestOperation) {
  const label = operation.kind === 'issue' ? 'Proof setup' : operation.kind === 'claim' ? 'Identity claim' : 'Backup proof update';
  if (operation.status === 'blocked' || operation.status === 'rejected') return operation.error || `${label} needs review before continuing.`;
  if (operation.status === 'confirmed') return `${label} confirmed on CKB testnet.`;
  if (operation.status === 'submitted') return `${label} is awaiting CKB testnet confirmation.`;
  if (operation.status === 'accepted') return `${label} is saved for submission. Retry to continue the saved transaction.`;
  return operation.kind === 'issue' ? 'Your proof setup is ready. Continue with Rivet’s sponsored transaction.' : `${label} is ready for your approval.`;
}

export function CotaManifest({ signer, verified, isJoyId, disabled, onBusyChange, onEnabledChange }: Props) {
  const [state, setState] = useState<ManifestState | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'wallet' | 'server' | null>(null);
  const activeWait = useRef<AbortController | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<Promise<void> | null>(null);
  const mutation = useRef(false);
  const version = useRef(0);
  const approved = useRef<{ id: string; transaction: ccc.TransactionLike } | null>(null);
  const wallet = useRef({ signer, verified, isJoyId });
  wallet.current = { signer, verified, isJoyId };

  const refresh = useCallback(() => {
    if (request.current) return request.current;
    const requestVersion = version.current;
    request.current = fetch('/api/user/cota/manifest', { cache: 'no-store', signal: AbortSignal.timeout(30000) })
      .then(readManifest)
      .then(result => {
        if (requestVersion === version.current) { setState(result); setError(''); }
      })
      .finally(() => { request.current = null; });
    return request.current;
  }, []);

  useEffect(() => {
    refresh().catch(failure => setError(failure.message));
  }, [refresh]);
  useEffect(() => () => activeWait.current?.abort(), []);
  useEffect(() => {
    if (signer && verified && isJoyId) refresh().catch(failure => setError(failure.message));
  }, [signer, verified, isJoyId, refresh]);

  const operation = state?.operation;
  useEffect(() => {
    if (state) onEnabledChange?.(state.enabled);
  }, [state, onEnabledChange]);
  useEffect(() => {
    if (operation?.status !== 'submitted' && state?.nextStep !== 'wait') return;
    const timer = setInterval(() => {
      if (!busy) refresh().catch(failure => setError(failure.message));
    }, 10000);
    return () => clearInterval(timer);
  }, [operation?.status, state?.nextStep, busy, refresh]);

  const canUseWallet = !!signer && verified && isJoyId;
  const locked = busy || disabled || !canUseWallet || !state?.enabled;
  const needsApproval = operation?.status === 'prepared' && operation.kind !== 'issue' && !!operation.transaction;
  const hasSigned = !!operation && approved.current?.id === operation.id;
  const retryable = operation?.status === 'accepted' || (operation?.status === 'prepared' && (operation.kind === 'issue' || !operation.transaction));
  const waiting = operation?.status === 'submitted' || (state?.nextStep === 'wait' && !retryable);
  const blocked = operation?.status === 'rejected' || operation?.status === 'blocked' || state?.nextStep === 'blocked';
  const requiresConsent = state?.nextStep === 'issue' && !operation;
  const reviewKind = operation && operation.status !== 'confirmed' ? operation.kind : state?.nextStep === 'issue' ? 'issue' : state?.nextStep === 'claim' ? 'claim' : 'update';

  async function act(action: 'prepare' | 'submit' | 'retry') {
    if (mutation.current || locked || !state || (requiresConsent && !consented)) return;
    mutation.current = true;
    version.current += 1;
    const startingSigner = signer;
    const controller = new AbortController();
    activeWait.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    let signing = false;
    try {
      let signedTransaction: ccc.TransactionLike | undefined;
      if (action === 'submit') {
        if (!operation || operation.kind === 'issue' || !operation.transaction || !startingSigner) return;
        if (approved.current?.id !== operation.id) {
          signing = true;
          setPhase('wallet');
          const signed = await waitForManifestStep(
            startingSigner.signTransaction(ccc.Transaction.from(operation.transaction)), 'wallet', 90000, controller.signal,
          );
          signing = false;
          approved.current = { id: operation.id, transaction: JSON.parse(signed.stringify()) };
        }
        signedTransaction = approved.current.transaction;
      }
      if (wallet.current.signer !== startingSigner || !wallet.current.verified || !wallet.current.isJoyId) {
        throw new Error('Reconnect your verified JoyID wallet to continue the saved transaction.');
      }
      setPhase('server');
      const result = await waitForManifestStep(fetch('/api/user/cota/manifest', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(operation ? { operationId: operation.id } : {}), ...(signedTransaction ? { signedTransaction } : {}) }),
      }).then(readManifest), 'server', 60000, controller.signal);
      setState(result);
      if (result.operation?.status === 'confirmed') setNotice(operationMessage(result.operation));
      else if (result.nextStep === 'ready') setNotice('All your backup proofs are up to date.');
    } catch (failure) {
      if (failure instanceof ManifestWaitError) controller.abort();
      if ((failure as { code?: string })?.code === 'MANIFEST_SIGNATURE_INVALID') approved.current = null;
      const message = failure instanceof Error ? failure.message : 'Could not continue your CoTA manifest transaction.';
      setError(signing && !(failure instanceof ManifestWaitError) ? `${message} Your prepared transaction is saved. You can review it again.` : message);
      // Preserve the approved bytes if submission failed. A retry sends this exact transaction.
    } finally {
      mutation.current = false;
      activeWait.current = null;
      setPhase(null);
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <section className={styles.manifest} aria-labelledby="cota-manifest-title">
      <div className={styles.heading}><span className={styles.sectionIcon}><ShieldCheck size={20} aria-hidden="true" /></span><h3 id="cota-manifest-title">Backup proofs</h3></div>
      {!state && !error && <p role="status" className={styles.description}>Checking your backups…</p>}
      {state && !state.enabled && <p className={styles.description}>Proof setup is unavailable. Your backups still work.</p>}
      {state?.latest && !state.confirmed && <p className={styles.description}>{state.latest.backupCount} public backup{state.latest.backupCount === 1 ? '' : 's'} ready to link to your identity.</p>}
      {state?.confirmed && (
        <div className={styles.summary}>
          <strong className={styles.count}>{state.confirmed.backupCount}</strong>
          <span className={styles.description}>backup proof{state.confirmed.backupCount === 1 ? '' : 's'} linked to your identity</span>
          {state.nextStep === 'ready' && !state.hasChanges && <span className={styles.success} role="status"><CheckCircle2 size={16} aria-hidden="true" /> All synced</span>}
          {state.hasChanges && <p className={styles.description}>New backups ready to sync</p>}
        </div>
      )}
      {waiting && <p className={styles.pending} role="status"><LoaderCircle size={16} className={styles.spinner} aria-hidden="true" /> Confirming on testnet…</p>}
      {blocked && operation && <p role="alert" className={styles.error}>{operationMessage(operation)}</p>}
      {state?.error && <p role="alert" className={styles.error}>{state.error}</p>}
      {!canUseWallet && <p className={styles.description}>Connect your identity wallet to make changes.</p>}
      {notice && !reviewOpen && !(state?.nextStep === 'ready' && !state.hasChanges) && <p role="status">{notice}</p>}
      {busy && !reviewOpen && <p role="status" className={styles.pending}><LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />{phase === 'wallet' ? 'Approve in the JoyID window…' : 'Saving your update…'}</p>}
      {error && !reviewOpen && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        {busy && !reviewOpen && <button type="button" className="btn btn--secondary" onClick={() => setReviewOpen(true)}>View progress</button>}
        {needsApproval && <button type="button" className="btn btn--primary" disabled={locked} onClick={() => setReviewOpen(true)}>Review update</button>}
        {retryable && !waiting && <button type="button" className="btn btn--primary" disabled={locked} onClick={() => setReviewOpen(true)}>Continue setup</button>}
        {state?.enabled && !needsApproval && !retryable && !waiting && !blocked && (state.nextStep !== 'ready' || state.hasChanges) && (
          <button type="button" className="btn btn--primary" disabled={locked} onClick={() => setReviewOpen(true)}>
            {state.nextStep === 'issue' ? 'Set up backup proofs' : state.nextStep === 'claim' ? 'Claim your identity' : 'Sync backup proofs'}
          </button>
        )}
        {state?.confirmed && <button type="button" className="btn btn--secondary" onClick={() => setProofOpen(true)}>View proof</button>}
        <RefreshButton label="Check status" disabled={disabled && !busy} onRefresh={() => { setError(''); return refresh(); }} onError={failure => setError(failure.message)} />
      </div>
      <HelpButton title="What are backup proofs?">
        <p>Backup proofs link your completed public backups to your developer identity on CKB. Your backup files remain on IPFS.</p>
        <p>Rivet creates the identity records, then you claim them with JoyID. Later, choose <strong>Sync backup proofs</strong> to include newer backups.</p>
        <p>You review each update and its fee before approving in JoyID. Syncing uses your existing backups without uploading them again.</p>
        <p>The technical record is called a CoTA manifest. Use <strong>View proof</strong> to inspect or download it.</p>
      </HelpButton>
      <ActionDialog open={proofOpen} onClose={() => setProofOpen(false)} title="Your backup proof">
        <p>{state?.confirmed?.backupCount} public backup proof{state?.confirmed?.backupCount === 1 ? '' : 's'} linked to your identity.</p>
        <p className={styles.commitment}><strong>Manifest commitment</strong><br />{state?.confirmed?.root}</p>
        {state?.confirmed?.explorerUrl && <a href={state.confirmed.explorerUrl} target="_blank" rel="noreferrer">View confirmed transaction ↗</a>}
        {state?.confirmed?.exportUrl && <a href={state.confirmed.exportUrl} download="rivet-cota-manifest-proof.json">Download verification proof</a>}
      </ActionDialog>
      <ActionDialog open={reviewOpen} onClose={() => setReviewOpen(false)} title={reviewKind === 'issue' ? 'Set up your backup proofs' : reviewKind === 'claim' ? 'Claim your developer identity' : 'Sync your backup proofs'} actions={<>
        <button type="button" className="btn btn--secondary" onClick={() => setReviewOpen(false)}>{busy ? 'Hide progress' : state?.nextStep === 'ready' && !state.hasChanges ? 'Done' : 'Not now'}</button>
        {needsApproval ? <button type="button" className="btn btn--primary" disabled={locked} onClick={() => act('submit')}>{busy ? phase === 'wallet' ? 'Waiting for JoyID…' : 'Saving update…' : hasSigned ? 'Retry submission' : 'Approve in JoyID'}</button>
          : retryable ? <button type="button" className="btn btn--primary" disabled={locked} onClick={() => act('retry')}>{busy ? 'Working…' : 'Continue setup'}</button>
          : !waiting && !blocked && (state?.nextStep !== 'ready' || state?.hasChanges) && <button type="button" className="btn btn--primary" disabled={locked || (requiresConsent && !consented)} onClick={() => act('prepare')}>{busy ? 'Preparing…' : requiresConsent ? 'Create backup proofs' : reviewKind === 'claim' ? 'Prepare claim' : 'Prepare update'}</button>}
      </>}>
        <p>{reviewKind === 'issue' ? 'Create public records that connect your GitHub identity to your JoyID wallet. You will claim them with JoyID before adding your backup proofs.' : reviewKind === 'claim' ? 'Move your identity records into your own JoyID wallet. Review the prepared transaction before approving.' : 'Link your completed public backups to your identity. Your existing backup files and anchors will be reused.'}</p>
        {requiresConsent && <label className={styles.consent}><input type="checkbox" checked={consented} disabled={busy || disabled} onChange={event => setConsented(event.target.checked)} /><span>Create the two public CoTA records for my developer identity.</span></label>}
        {operation && <p role="status">{operationMessage(operation)}</p>}
        {operation?.kind !== 'issue' && operation?.feeCKB && <div className={styles.review}><strong>Network fee: {operation.feeCKB} test CKB</strong><p>Paid from your existing identity cell.</p></div>}
        {operation?.root && <details className={styles.details}><summary>Technical details</summary><p className={styles.commitment}>{operation.root}</p></details>}
        {operation?.explorerUrl && <a href={operation.explorerUrl} target="_blank" rel="noreferrer">View transaction ↗</a>}
        {phase === 'wallet' && <><p role="status">Open the JoyID window and approve with your passkey.</p><button type="button" className="btn btn--secondary" onClick={() => activeWait.current?.abort()}>Stop waiting</button></>}
        {phase === 'server' && <p role="status">Checking and submitting your saved transaction…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </ActionDialog>
    </section>
  );
}
