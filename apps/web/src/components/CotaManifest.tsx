'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import styles from './CotaManifest.module.css';
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
  const label = operation.kind === 'issue' ? 'Metadata issuance' : operation.kind === 'claim' ? 'Manifest claim' : 'Manifest update';
  if (operation.status === 'blocked' || operation.status === 'rejected') return operation.error || `${label} needs review before continuing.`;
  if (operation.status === 'confirmed') return `${label} confirmed on CKB testnet.`;
  if (operation.status === 'submitted') return `${label} is awaiting CKB testnet confirmation.`;
  if (operation.status === 'accepted') return `${label} is saved for submission. Retry to continue the saved transaction.`;
  return operation.kind === 'issue' ? 'Metadata issuance is prepared. Continue to submit Rivet’s sponsored transaction.' : `${label} is prepared. Review the fee and approve with JoyID when ready.`;
}

export function CotaManifest({ signer, verified, isJoyId, disabled, onBusyChange, onEnabledChange }: Props) {
  const [state, setState] = useState<ManifestState | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'wallet' | 'server' | null>(null);
  const activeWait = useRef<AbortController | null>(null);
  const [postponed, setPostponed] = useState(false);
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

  const operation = state?.operation;
  useEffect(() => {
    if (state) onEnabledChange?.(state.enabled);
  }, [state, onEnabledChange]);
  useEffect(() => { setPostponed(false); }, [operation?.id]);
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
      setPostponed(false);
      if (result.operation?.status === 'confirmed') setNotice(operationMessage(result.operation));
      else if (result.nextStep === 'ready') setNotice('Your confirmed CoTA manifest already includes the latest completed public backups.');
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
      <h3 id="cota-manifest-title">Your CoTA manifest</h3>
      <p className={styles.description}>Store a commitment to your developer identity and public backup proofs in your JoyID-owned CoTA tree. Rivet first issues two CoTA metadata NFT records containing your developer identity. Claim them with JoyID, then add completed public backup proofs through an approved update. GitHub backups continue without wallet approval.</p>
      {!state && !error && <p role="status">Loading CoTA manifest status…</p>}
      {state && !state.enabled && <p>CoTA manifest setup is not available yet. Your existing backups continue to work.</p>}
      {state?.latest && <p>Public backups stored in Rivet: {state.latest.backupCount}.</p>}
      {state?.confirmed && (
        <div className={styles.review}>
          <p>Backup proofs synced to CoTA: {state.confirmed.backupCount}.</p>
          <p className={styles.commitment}>Manifest commitment: {state.confirmed.root}</p>
          {state.hasChanges && <p>Your existing backups can be synced to this manifest. Sync verifies their saved references and asks for JoyID approval; it does not create another backup.</p>}
          {state.confirmed.explorerUrl && <a href={state.confirmed.explorerUrl} target="_blank" rel="noreferrer">View confirmed CoTA transaction</a>}
          {state.confirmed.exportUrl && <a href={state.confirmed.exportUrl} download="rivet-cota-manifest-proof.json">Download CoTA manifest proof</a>}
        </div>
      )}
      {requiresConsent && state?.enabled && (
        <label className={styles.consent}>
          <input type="checkbox" checked={consented} disabled={busy || disabled} onChange={event => setConsented(event.target.checked)} />
          <span>Create the two public CoTA metadata records for my developer identity. I will claim them with JoyID and add backup proofs through later updates.</span>
        </label>
      )}
      {operation && (
        <div className={styles.review}>
          <p role="status">{operationMessage(operation)}</p>
          {operation.root && <p className={styles.commitment}>Prepared manifest commitment: {operation.root}</p>}
          {operation.kind !== 'issue' && operation.feeCKB && <p>Transaction fee: {operation.feeCKB} test CKB from your identity cell. Review this amount before approval.</p>}
          {operation.explorerUrl && <a href={operation.explorerUrl} target="_blank" rel="noreferrer">View {operation.kind === 'issue' ? 'issuance' : operation.kind} transaction</a>}
          {postponed && <p>The prepared transaction is saved. Resume when you are ready to approve.</p>}
        </div>
      )}
      {state?.error && <p role="alert" className={styles.error}>{state.error}</p>}
      {!canUseWallet && <p>Connect your verified CKB testnet JoyID wallet to prepare or approve a CoTA manifest.</p>}
      {notice && <p role="status">{notice}</p>}
      {phase === 'wallet' && <p role="status">Waiting for JoyID approval. Check the JoyID popup or browser tab and complete the passkey prompt. If it is stuck, stop waiting and close that window before retrying.</p>}
      {phase === 'server' && <p role="status">Checking and submitting your saved transaction. You can refresh its status while this request finishes.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        {needsApproval && !postponed && <>
          <button type="button" className="btn btn--primary" disabled={locked} onClick={() => act('submit')}>{busy ? phase === 'wallet' ? 'Waiting for JoyID…' : 'Checking transaction…' : hasSigned ? 'Retry approved transaction' : 'Review and approve in JoyID'}</button>
          <button type="button" className="btn btn--secondary" disabled={busy || disabled} onClick={() => setPostponed(true)}>Not now</button>
        </>}
        {needsApproval && postponed && <button type="button" className="btn btn--primary" disabled={locked} onClick={() => setPostponed(false)}>Resume review</button>}
        {retryable && !waiting && <button type="button" className="btn btn--primary" disabled={locked} onClick={() => act('retry')}>{busy ? 'Working…' : 'Continue saved transaction'}</button>}
        {state?.enabled && !needsApproval && !retryable && !waiting && !blocked && (state.nextStep !== 'ready' || state.hasChanges) && (
          <button type="button" className="btn btn--primary" disabled={locked || (requiresConsent && !consented)} onClick={() => act('prepare')}>
            {busy ? 'Working…' : state.nextStep === 'issue' ? 'Create CoTA metadata records' : state.nextStep === 'claim' ? 'Prepare JoyID claim' : 'Sync existing backup proofs'}
          </button>
        )}
        {phase === 'wallet' && <button type="button" className="btn btn--secondary" onClick={() => activeWait.current?.abort()}>Stop waiting</button>}
        <button type="button" className="btn btn--secondary" disabled={disabled && !busy} onClick={() => refresh().catch(failure => setError(failure.message))}>Refresh manifest status</button>
      </div>
    </section>
  );
}
