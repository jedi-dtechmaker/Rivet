import Link from 'next/link';
import { Package, GitBranch, Archive, FileCheck } from 'lucide-react';
import { ContentPage } from '@/components/ContentPage';
import styles from '@/components/ContentPage.module.css';

export const metadata = { title: 'Packages · Rivet' };

export default function PackagesPage() {
  return <ContentPage title="Keep the source behind your packages." description="Rivet backs up package source code through its Git repository. Use this space to understand what is saved and prepare a recovery plan." actions={<><Link href="/dashboard" className="btn btn--primary">Choose a repository</Link><Link href="/docs#restore" className="btn btn--secondary">Recovery guide</Link></>}>
    <div className={styles.grid}>
      <article className={styles.card}><Package size={24} aria-hidden="true" /><h2>Package manifests</h2><p>Files such as package.json, Cargo.toml, and pyproject.toml are included when they are committed to your repository.</p></article>
      <article className={styles.card}><GitBranch size={24} aria-hidden="true" /><h2>Release history</h2><p>Git branches, tags, and commits are included in the mirrored repository. Tag the versions you want to identify during recovery.</p></article>
      <article className={styles.card}><FileCheck size={24} aria-hidden="true" /><h2>Lockfiles and build instructions</h2><p>Commit lockfiles and document build steps so you can recreate the environment after restoring your source.</p></article>
    </div>
    <section className={styles.section}><h2>A package recovery checklist</h2><ol><li>Commit the source, manifest, lockfile, and build instructions to a public GitHub repository.</li><li>Create a Rivet backup and check that the repository shows <strong>Backed up</strong>.</li><li>Update the backup after a release, or enable Auto-backup for repositories with configured push hooks.</li><li>Export a private recovery file and try an exact restore into a new local directory.</li></ol></section>
    <article className={styles.card}><Archive size={24} aria-hidden="true" /><h2>Package registries are separate</h2><p>This release does not publish or mirror npm, crates.io, PyPI, or GitHub Packages artifacts. GitHub release attachments and external Git LFS objects also need a separate backup plan. This page documents source recovery; it is not a package registry.</p><Link href="/docs#backups">Understand repository backups →</Link></article>
  </ContentPage>;
}
