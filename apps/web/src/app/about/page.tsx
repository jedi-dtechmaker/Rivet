import { Shield, Github, Globe, GitFork } from 'lucide-react';
import styles from './page.module.css';

export default function AboutPage() {
  return (
    <div className={styles.about_page}>
      <div className={styles.hero}>
        <div className={styles.hero_icon}>
          <Shield size={48} />
        </div>
        <h1 className={styles.title}>The Rivet Manifesto</h1>
        <p className={styles.subtitle}>
          We believe developers should own their history, not rent it from centralized platforms.
        </p>
      </div>

      <div className={styles.content}>
        <div className={styles.section}>
          <h2>The Problem</h2>
          <p>
            When a developer gets suspended or banned from a centralized platform like GitHub, they don't just lose their current code. They lose their entire professional history. Every commit, every timestamp, every contribution graph that proved their experience — wiped out in an instant. This is a single point of failure for open-source development.
          </p>
        </div>

        <div className={styles.section}>
          <h2>The Solution</h2>
          <p>
            Rivet is a decentralized bridge. We don't want to replace GitHub — we want to make it safe to use. By creating `git clone --mirror` backups and storing them on IPFS, your code is immortalized. By computing a Merkle tree of your commits and anchoring the root on the Nervos CKB blockchain, your history is provable on-chain.
          </p>
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <Github size={24} className={styles.card_icon} />
            <h3>Centralized Convenience</h3>
            <p>Keep using the tools you love. When you link your GitHub, we handle the backups automatically.</p>
          </div>
          <div className={styles.card}>
            <Globe size={24} className={styles.card_icon} />
            <h3>Decentralized Security</h3>
            <p>Your backups are stored on IPFS. Your proofs are anchored on CKB. No single entity can delete them.</p>
          </div>
          <div className={styles.card}>
            <GitFork size={24} className={styles.card_icon} />
            <h3>Seamless Restoration</h3>
            <p>Create a new repository anywhere, and push your history back from the IPFS bundle.</p>
          </div>
        </div>

        <div className={styles.footer_cta}>
          <h2>Take control of your code.</h2>
          <button className="btn btn--primary btn--lg" style={{ marginTop: 'var(--space-4)' }}>Connect Wallet</button>
        </div>
      </div>
    </div>
  );
}
