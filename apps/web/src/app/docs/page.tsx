import { Book, Code, Terminal, Layers } from 'lucide-react';
import styles from './page.module.css';

export default function DocsPage() {
  return (
    <div className={styles.docs_page}>
      <div className={styles.sidebar}>
        <div className={styles.nav_group}>
          <h3>Getting Started</h3>
          <a href="#" className={styles.active}>Introduction</a>
          <a href="#">Quick Start</a>
          <a href="#">Wallet Setup</a>
        </div>
        <div className={styles.nav_group}>
          <h3>Core Concepts</h3>
          <a href="#">Architecture</a>
          <a href="#">Merkle Proofs</a>
          <a href="#">RGB++ Assets</a>
        </div>
        <div className={styles.nav_group}>
          <h3>Developers</h3>
          <a href="#">API Reference</a>
          <a href="#">CLI Usage</a>
          <a href="#">Self-Hosting</a>
        </div>
      </div>

      <div className={styles.content}>
        <h1>Documentation</h1>
        <p className={styles.lead}>Everything you need to know to secure your code with Rivet.</p>

        <div className={styles.cards}>
          <div className={styles.card}>
            <Book size={24} className={styles.card_icon} />
            <h3>Platform Guide</h3>
            <p>Learn how to connect your GitHub and backup your repositories through the web UI.</p>
          </div>
          <div className={styles.card}>
            <Terminal size={24} className={styles.card_icon} />
            <h3>CLI Tool</h3>
            <p>For power users. Run backups locally and anchor directly to your own CKB node.</p>
          </div>
          <div className={styles.card}>
            <Layers size={24} className={styles.card_icon} />
            <h3>Architecture</h3>
            <p>Deep dive into how we map git histories to Merkle trees and store them on IPFS.</p>
          </div>
          <div className={styles.card}>
            <Code size={24} className={styles.card_icon} />
            <h3>API Integration</h3>
            <p>Integrate Rivet's verification system into your own developer tools or HR platforms.</p>
          </div>
        </div>

        <h2>What is Rivet?</h2>
        <p>Rivet is a decentralized repository manager designed as a fallback and permanent archive for your GitHub repositories. By mapping your git commit history to a Merkle tree and anchoring the root hash on the Nervos CKB blockchain, Rivet makes your code history immutable and independently verifiable.</p>
      </div>
    </div>
  );
}
