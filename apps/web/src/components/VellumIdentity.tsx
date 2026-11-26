'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { CheckCircle2, ExternalLink, Fingerprint, Link2, LoaderCircle, ShieldAlert, Unlink, Wallet } from 'lucide-react';
import { ActionDialog } from './ActionDialog';
import styles from './VellumIdentity.module.css';

type Claim = {
  repositoryId: string;
  repository: { fullName: string };
  status: string;
  transactionHash: string | null;
  explorerUrl: string | null;
  lastErrorCode: string | null;
};

type IdentityState = {
  binding: null | {
    did: string;
    displayName: string | null;
    isPublic: boolean;
    status: 'verified' | 'controller_changed' | 'unavailable';
    verifiedAt: string;
  };
  claims: Claim[];
  profileUrl: string | null;
};

async function responseJson(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'The request could not be completed.');
  return value;
}

const claimLabel: Record<string, string> = {
  preparing: 'Preparing',
  prepared: 'Ready to submit',
  submitted: 'Awaiting confirmation',
  confirmed: 'Claim confirmed',
  review_required: 'Needs review',
};

export function VellumIdentity() {
  const { open } = ccc.useCcc();
  const signer = ccc.useSigner();
  const [state, setState] = useState<IdentityState | null>(null);
  const [did, setDid] = useState('');
  const [sharePublicly, setSharePublicly] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const reconciled = useRef(false);

  const refresh = useCallback(async () => {
    const value = await fetch('/api/user/vellum', { cache: 'no-store' }).then(responseJson) as IdentityState;
    setState(value);
    return value;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/user/vellum', { cache: 'no-store', signal: controller.signal })
      .then(responseJson)
      .then(async (value: IdentityState) => {
        if (controller.signal.aborted) return;
        setState(value);
        if (!value.binding?.isPublic || reconciled.current) return;
        reconciled.current = true;
        await fetch('/api/user/vellum/claims', { method: 'POST', signal: controller.signal }).catch(() => undefined);
        if (!controller.signal.aborted) await refresh().catch(() => undefined);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Vellum identity status is temporarily unavailable.'); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!state?.binding?.isPublic) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      await fetch('/api/user/vellum/claims', { method: 'POST', signal: controller.signal }).catch(() => undefined);
      if (!controller.signal.aborted) await refresh().catch(() => undefined);
    }, 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh, state?.binding?.isPublic]);

  async function linkIdentity() {
    if (!signer) { await open(); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const challenge = await fetch('/api/user/vellum/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ did: did.trim() }),
      }).then(responseJson);
      const signed = await signer.signMessage(challenge.message);
      const value = await fetch('/api/user/vellum', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          challengeId: challenge.challengeId,
          isPublic: sharePublicly,
          signature: { identity: signed.identity, signature: signed.signature, signType: signed.signType },
        }),
      }).then(responseJson) as IdentityState;
      setState(value); setEditing(false); setDid('');
      setNotice(sharePublicly ? 'Vellum identity linked and shared on your profile.' : 'Vellum identity linked privately.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The identity could not be linked.');
    } finally { setBusy(false); }
  }

  async function setVisibility(isPublic: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await fetch('/api/user/vellum', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic }) }).then(responseJson) as IdentityState;
      setState(value);
      setNotice(isPublic ? 'Your Vellum identity is now public.' : 'Your Vellum identity is now private.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Visibility could not be updated.'); }
    finally { setBusy(false); }
  }

  async function unlinkIdentity() {
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await fetch('/api/user/vellum', { method: 'DELETE' }).then(responseJson) as IdentityState;
      setState(value); setConfirmUnlink(false); setEditing(false);
      setNotice('Vellum identity unlinked. Prepared or published claims are not removed.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The identity could not be unlinked.'); }
    finally { setBusy(false); }
  }

  const binding = state?.binding;
  const showForm = !binding || editing;
  return <section className={styles.panel} aria-labelledby="vellum-identity-title">
    <div className={styles.heading}>
      <span className={styles.icon}><Fingerprint size={22} aria-hidden="true" /></span>
      <div><h2 id="vellum-identity-title">Vellum identity</h2><p>Portable identity and reputation for your public work.</p></div>
      {binding?.status === 'verified' && <span className={styles.verified}><CheckCircle2 size={14} aria-hidden="true" /> Verified</span>}
    </div>

    {!state && !error && <p role="status" className={styles.muted}><LoaderCircle size={15} className={styles.spinner} aria-hidden="true" /> Loading identity…</p>}

    {binding && !editing && <div className={styles.binding}>
      <div className={styles.bindingMain}>
        <strong>{binding.displayName || 'Linked identity'}</strong>
        <code>{binding.did}</code>
      </div>
      {binding.status === 'controller_changed' && <p className={styles.warning}><ShieldAlert size={16} aria-hidden="true" /> The controller changed. Link this identity again with its current wallet.</p>}
      {binding.status === 'unavailable' && <p className={styles.warning}><ShieldAlert size={16} aria-hidden="true" /> Controller verification is temporarily unavailable.</p>}
      <label className={styles.consent}><input type="checkbox" checked={binding.isPublic} disabled={busy}
        onChange={event => setVisibility(event.target.checked)} /><span>Show this identity and its Vellum reputation on my public Rivet profile.</span></label>
      <div className={styles.actions}>
        {state?.profileUrl && <a className="btn btn--secondary" href={state.profileUrl} target="_blank" rel="noreferrer">View Vellum profile <ExternalLink size={14} aria-hidden="true" /></a>}
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setEditing(true); setDid(binding.did); setSharePublicly(binding.isPublic); }}><Link2 size={15} aria-hidden="true" /> Change identity</button>
        <button type="button" className={styles.unlinkButton} disabled={busy} onClick={() => setConfirmUnlink(true)}><Unlink size={15} aria-hidden="true" /> Unlink</button>
      </div>
    </div>}

    {showForm && state && <div className={styles.form}>
      <label htmlFor="vellum-did">Identity DID</label>
      <input id="vellum-did" value={did} disabled={busy} autoComplete="off" spellCheck={false}
        placeholder="did:ckb:..." onChange={event => setDid(event.target.value)} />
      <label className={styles.consent}><input type="checkbox" checked={sharePublicly} disabled={busy}
        onChange={event => setSharePublicly(event.target.checked)} /><span>Share this identity publicly and issue Vellum evidence for eligible public backups.</span></label>
      <div className={styles.actions}>
        <button type="button" className="btn btn--primary" disabled={busy || (!!signer && !did.trim())} onClick={linkIdentity}>
          {busy ? <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" /> : signer ? <Link2 size={15} aria-hidden="true" /> : <Wallet size={15} aria-hidden="true" />}
          {busy ? 'Waiting for approval…' : signer ? 'Verify and link' : 'Connect wallet'}
        </button>
        {binding && <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</button>}
      </div>
    </div>}

    {!!state?.claims.length && <div className={styles.claims}>
      <h3>Backup claims</h3>
      {state.claims.map(claim => <div className={styles.claim} key={claim.repositoryId}>
        <span><strong>{claim.repository.fullName}</strong><small>{claimLabel[claim.status] || claim.status}</small></span>
        {claim.explorerUrl && <a href={claim.explorerUrl} target="_blank" rel="noreferrer" aria-label={`View ${claim.repository.fullName} claim transaction`}><ExternalLink size={16} aria-hidden="true" /></a>}
      </div>)}
    </div>}

    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <ActionDialog open={confirmUnlink} onClose={() => setConfirmUnlink(false)} title="Unlink Vellum identity" actions={<>
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setConfirmUnlink(false)}>Cancel</button>
      <button type="button" className="btn btn--primary" disabled={busy} onClick={unlinkIdentity}>{busy ? 'Unlinking…' : 'Unlink identity'}</button>
    </>}>
      <p>Rivet will stop showing this identity and creating new claims for it. Claims already prepared or published cannot be removed.</p>
    </ActionDialog>
  </section>;
}
