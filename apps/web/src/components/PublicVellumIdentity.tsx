'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Fingerprint, ShieldAlert } from 'lucide-react';
import styles from './VellumIdentity.module.css';

type PublicIdentity = {
  did: string;
  displayName: string | null;
  status: 'verified' | 'controller_changed' | 'unavailable';
  profileUrl: string;
  reputation: null | {
    policyVersion: string;
    overall: { score: number; maximum: number };
    categories: { id: string; score: number; maximum: number }[];
    evidenceCount: number;
  };
};

const categoryName = (value: string) => value.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function PublicVellumIdentity({ username }: { username: string }) {
  const [identity, setIdentity] = useState<PublicIdentity | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/profile/${encodeURIComponent(username)}/vellum`, { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted) setIdentity(value); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [username]);
  if (!identity) return null;
  return <section className={styles.publicPanel} aria-labelledby="public-vellum-title">
    <div className={styles.publicHeading}>
      <span className={styles.icon}><Fingerprint size={22} aria-hidden="true" /></span>
      <div><p>Vellum identity</p><h2 id="public-vellum-title">{identity.displayName || 'Portable reputation'}</h2></div>
      {identity.status === 'verified' && <span className={styles.verified}><CheckCircle2 size={14} aria-hidden="true" /> Controller verified</span>}
    </div>
    <code className={styles.did}>{identity.did}</code>
    {identity.status !== 'verified' && <p className={styles.warning}><ShieldAlert size={16} aria-hidden="true" />
      {identity.status === 'controller_changed' ? 'The identity controller changed after it was linked.' : 'The identity controller is temporarily unavailable.'}</p>}
    {identity.reputation && <div className={styles.reputation}>
      <div className={styles.score}><strong>{identity.reputation.overall.score}</strong><span>of {identity.reputation.overall.maximum}<small>Reputation</small></span></div>
      <div className={styles.categories}>{identity.reputation.categories.map(category => <span key={category.id}>
        <small>{categoryName(category.id)}</small><strong>{category.score}</strong><em>/ {category.maximum}</em>
      </span>)}</div>
      <p>{identity.reputation.evidenceCount} accepted evidence item{identity.reputation.evidenceCount === 1 ? '' : 's'} under {identity.reputation.policyVersion}.</p>
    </div>}
    <a className="btn btn--secondary" href={identity.profileUrl} target="_blank" rel="noreferrer">View Vellum evidence <ExternalLink size={14} aria-hidden="true" /></a>
  </section>;
}
