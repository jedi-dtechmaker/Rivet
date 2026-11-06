import Link from 'next/link';
import { BookOpen, ShieldCheck, Fingerprint, History } from 'lucide-react';
import { ContentPage } from '@/components/ContentPage';
import styles from '@/components/ContentPage.module.css';

export const metadata = { title: 'Guides & documentation · Rivet' };

const guides = [
  { href: '#quick-start', title: 'Make your first backup', text: 'Sign in with GitHub and save a public repository.', icon: BookOpen },
  { href: '#identity', title: 'Connect your identity', text: 'Link JoyID, activate your identity, and sync backup proofs.', icon: ShieldCheck },
  { href: '#passport', title: 'Create a passport', text: 'Mint an optional developer collectible to your wallet.', icon: Fingerprint },
  { href: '#restore', title: 'Recover your code', text: 'Restore saved Git history and prepare a recovery file.', icon: History },
];

export default function DocsPage() {
  return <ContentPage title="A little guidance. More peace of mind." description="Practical guides for backing up your code, connecting your identity, and recovering your Git history." actions={<Link href="/dashboard" className="btn btn--primary">Open your dashboard</Link>}>
    <nav aria-label="Documentation topics" className={styles.toc}>
      <a href="#quick-start">First backup</a><a href="#backups">Backup controls</a><a href="#identity">Identity</a><a href="#passport">Passport</a><a href="#restore">Restore</a><a href="#verification">Verification</a><a href="#developers">Developer tools</a>
    </nav>
    <div className={styles.grid}>{guides.map(({ href, title, text, icon: Icon }) => <a key={href} href={href} className={styles.card}><Icon size={24} aria-hidden="true" /><h2>{title}</h2><p>{text}</p><span>Read guide →</span></a>)}</div>
    <section id="quick-start" className={styles.section}>
      <h2>Your first backup</h2>
      <ol>
        <li><Link href="/dashboard">Sign in with GitHub</Link> to see your repositories.</li>
        <li>Choose a public repository and select <strong>Back up now</strong>.</li>
        <li>Review what will be saved, then select <strong>Start backup</strong>. You can follow progress while the worker runs.</li>
        <li>When the card shows <strong>Backed up</strong>, open the repository to inspect its saved history and backup references.</li>
      </ol>
      <p>No wallet is needed. Rivet sponsors the CKB testnet backup anchor fee. Private repository backups are not available in this release.</p>
    </section>
    <section id="backups" className={styles.section}>
      <h2>Know your backup controls</h2>
      <div className={styles.grid}>
        <article className={styles.card}><h3>Refresh repositories</h3><p>Reload your GitHub repository list. This does not start a backup.</p></article>
        <article className={styles.card}><h3>Update backup</h3><p>Save the latest history of a repository you have already backed up.</p></article>
        <article className={styles.card}><h3>Auto-backup</h3><p>Enable GitHub push notifications for your already backed-up public repositories. Rivet starts a new backup when a notification arrives.</p></article>
      </div>
      <details className={styles.details}><summary>A backup is taking longer than expected</summary><div><p>Use <strong>View progress</strong> to check the worker run. A slow or interrupted status request does not necessarily mean the backup stopped. Check the existing run before starting another backup.</p><p>If automatic backup setup fails, check your GitHub repository admin permissions and sign in again to refresh webhook access. A newly backed-up repository may need Auto-backup turned off and on to install its hook.</p></div></details>
    </section>
    <section id="identity" className={styles.section}>
      <h2>An identity you control</h2>
      <p>The optional <strong>Developer identity</strong> section connects your GitHub account and public backup proofs to your JoyID wallet.</p>
      <ol>
        <li>Connect a <strong>JoyID wallet on CKB testnet</strong> from the dashboard.</li>
        <li>Select <strong>Activate identity</strong> and approve the ownership check with your passkey. Rivet covers identity activation.</li>
        <li>Select <strong>Set up backup proofs</strong>, then follow the claim and approval steps.</li>
        <li>After new backups complete, select <strong>Sync backup proofs</strong>. Review the fee before approving the update in JoyID.</li>
      </ol>
      <details className={styles.details}><summary>What is a CoTA manifest?</summary><div><p>It is a record of your developer identity and public backup commitments in your wallet-owned CoTA tree. <strong>View proof</strong> lets you inspect the transaction or download the verification package.</p><p>Syncing reuses existing backups. Reconnecting the same wallet or checking an unchanged state does not require a new publication transaction.</p></div></details>
    </section>
    <section id="passport" className={styles.section}>
      <h2>Your developer passport</h2>
      <p>After your identity and manifest are verified, choose <strong>Create passport</strong>. Prepare the mint, review the locked capacity and network fee, then approve in JoyID.</p>
      <details className={styles.details}><summary>Costs, ownership, and the passport image</summary><div><p>Your wallet provides the passport’s locked test CKB and pays its network fee. This is separate from Rivet-sponsored identity activation.</p><p>The Sovereign Passport is a Spore digital object containing your identity snapshot at mint time. The app displays its visual card. Later backup updates appear in your current identity record without changing the original passport snapshot.</p><p>Reopening a saved mint or checking its status resumes the same operation. If an approval was interrupted, use the existing mint controls.</p></div></details>
    </section>
    <section id="restore" className={styles.section}>
      <h2>Recover your repository</h2>
      <p>Open one of your backed-up repositories and use its restore controls. Browser restore requires a signed-in account authorized to access that backup. For local recovery, the source CLI can export a private recovery file and restore a new bare Git mirror.</p>
      <details className={styles.details}><summary>Local recovery with the source CLI</summary><div>
        <p>Use Node.js 24+ and Git from a checkout of the <a href="https://github.com/jedi-dtechmaker/Rivet" target="_blank" rel="noreferrer">Rivet repository</a>. Set <code>RIVET_URL</code> to your Rivet host and <code>RIVET_TOKEN</code> to a GitHub token for your registered account.</p>
        <pre><code>{`node packages/cli/src/cli.mjs status owner/repository --proof-out recovery.secret.json
node packages/cli/src/cli.mjs restore owner/repository --mode exact --proof recovery.secret.json --target ./recovered.git
git clone ./recovered.git ./working-copy`}</code></pre>
        <p>The recovery file includes private decryption material. Keep it outside version control. Once exported, local verification and restore use the proof, CKB RPC, and backup bundle without requiring the original GitHub repository.</p>
        <p>The source CLI is in Milestone 2 development. Published binaries and attribution remapping are still planned. See the <a href="https://github.com/jedi-dtechmaker/Rivet/blob/main/packages/cli/README.md" target="_blank" rel="noreferrer">CLI guide</a> for setup and current verification limits.</p>
      </div></details>
    </section>
    <section id="verification" className={styles.section}>
      <h2>Understand what is verified</h2>
      <p><Link href="/verify">Look up a backup</Link> using its transaction hash, IPFS CID, or <code>owner/repository</code>. The lookup finds a public backup record and checks its referenced CKB anchor.</p>
      <details className={styles.details}><summary>Backup records, identity proofs, and commit dates</summary><div><p>A backup anchor commits to a set of Git commits at a blockchain checkpoint. It does not certify the dates entered into those commits or guarantee that an IPFS gateway can currently serve the file.</p><p>A developer’s public profile separately checks a confirmed CoTA identity snapshot and current passport ownership. Use the exported manifest verifier for independent identity-proof checks.</p><p>Legacy backup anchors do not bind every piece of bundle metadata, including refs and file bytes. The CLI guide describes the checks it performs and the remaining limitations.</p></div></details>
    </section>
    <section id="developers" className={styles.section}>
      <h2>Build, integrate, or run your own instance</h2>
      <div className={styles.grid}>
        <article className={styles.card}><h3>CLI and API</h3><p>The source CLI supports backup, status, verification, and exact local restore. Authenticated backup and status requests use your GitHub bearer token.</p><a href="https://github.com/jedi-dtechmaker/Rivet/blob/main/packages/cli/README.md" target="_blank" rel="noreferrer">Read the CLI reference ↗</a></article>
        <article className={styles.card}><h3>Self-hosting</h3><p>Configure GitHub authentication, PostgreSQL, storage, workers, and CKB testnet services. Apply the documented release setup before enabling identity features.</p><a href="https://github.com/jedi-dtechmaker/Rivet/blob/main/docs/TESTNET_LAUNCH.md" target="_blank" rel="noreferrer">Open the deployment guide ↗</a></article>
        <article className={styles.card}><h3>Identity verification</h3><p>Inspect the manifest format, issuer setup, and standalone proof-verification procedure.</p><a href="https://github.com/jedi-dtechmaker/Rivet/blob/main/docs/COTA_MANIFEST_RUNBOOK.md" target="_blank" rel="noreferrer">Open the identity runbook ↗</a></article>
      </div>
    </section>
  </ContentPage>;
}
