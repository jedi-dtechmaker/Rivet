'use client';

import { useActionState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { saveSettings } from './actions';
import styles from '@/components/ContentPage.module.css';
import formStyles from './page.module.css';

export function SettingsForm({ bio, isProfilePublic }: { bio: string; isProfilePublic: boolean }) {
  const [result, action, pending] = useActionState(saveSettings, { error: '', saved: false });
  return <form action={action} className={styles.section}>
    <section className={styles.card}><h2>Your profile</h2><label htmlFor="profile-bio">Short bio</label><textarea id="profile-bio" name="bio" defaultValue={bio} maxLength={160} rows={3} className={formStyles.bio} placeholder="What are you building?" /><p>Up to 160 characters, shown on your public profile.</p></section>
    <section className={styles.card}><h2>Profile visibility</h2><label className={formStyles.checkbox}><input type="checkbox" name="isProfilePublic" defaultChecked={isProfilePublic} /><span>Share my public profile</span></label><p>Allow others to browse your public repository backups and identity proofs. Private repositories stay out of public discovery.</p><details className={styles.details}><summary>What happens if I make my profile private?</summary><div><p>Rivet hides your profile’s backup listings and identity proof endpoint from public visitors, and excludes your records from Explore and public backup lookup. Transactions already published to CKB remain public on the blockchain.</p></div></details></section>
    {result.error && <p role="alert" className={styles.error}>{result.error}</p>}
    {result.saved && !pending && <span role="status" className={styles.status}><CheckCircle2 size={16} aria-hidden="true" /> Settings saved</span>}
    <div className={styles.actions}><button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>{pending && <LoaderCircle size={16} className="spin" aria-hidden="true" />}{pending ? 'Saving…' : 'Save profile settings'}</button></div>
  </form>;
}
