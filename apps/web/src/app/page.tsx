'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Github, Lock, History, Database, ShieldCheck, Shield, ChevronRight } from 'lucide-react';
import { ccc } from '@ckb-ccc/connector-react';
import styles from './page.module.css';

export default function Home() {
  const { open, wallet } = ccc.useCcc();
  const router = useRouter();

  const handleConnect = () => {
    if (wallet) {
      router.push('/dashboard');
    } else {
      open();
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <div className={`${styles.hero__orb} ${styles['hero__orb--1']}`}></div>
        <div className={`${styles.hero__orb} ${styles['hero__orb--2']}`}></div>
        <div className={`${styles.hero__orb} ${styles['hero__orb--3']}`}></div>

        <div className={styles.hero__badge}>
          <span className={styles['hero__badge-dot']}></span>
          Powered by Nervos CKB & RGB++
        </div>

        <h1 className={styles.hero__title}>
          Your Code. Your Keys. <br />
          <span className={styles['hero__title-highlight']}>Your Proof. Forever.</span>
        </h1>

        <p className={styles.hero__subtitle}>
          A decentralized platform that backs up, timestamps, and restores your GitHub history using blockchain technology. Never lose your code or reputation again.
        </p>

        <div className={styles.hero__cta}>
          <button onClick={handleConnect} className={styles['hero__cta-primary']}>
            {wallet ? 'Go to Dashboard' : 'Connect Wallet'} <ArrowRight size={18} />
          </button>
          <a href="#how-it-works" className={styles['hero__cta-secondary']}>
            How it works
          </a>
        </div>

        <div className={styles.hero__terminal}>
          <div className={styles['hero__terminal-bar']}>
            <div className={`${styles['hero__terminal-dot']} ${styles['hero__terminal-dot--red']}`}></div>
            <div className={`${styles['hero__terminal-dot']} ${styles['hero__terminal-dot--yellow']}`}></div>
            <div className={`${styles['hero__terminal-dot']} ${styles['hero__terminal-dot--green']}`}></div>
            <div className={styles['hero__terminal-title']}>proof-cli</div>
          </div>
          <div className={styles['hero__terminal-body']}>
            <div className={styles['hero__terminal-line']}>
              <span className={styles['hero__terminal-prompt']}>~ ❯</span>
              <span className={styles['hero__terminal-cmd']}>proof backup --github jedi</span>
            </div>
            <div className={styles['hero__terminal-output']}>
              <div className={styles['hero__terminal-success']}>✓ Cloned 47 repositories (mirror mode)</div>
              <div className={styles['hero__terminal-success']}>✓ Computed Merkle root: 0x7a8b3c...</div>
              <div className={styles['hero__terminal-success']}>✓ Uploaded to IPFS: bafybei...</div>
              <div className={styles['hero__terminal-success']}>✓ Anchored on CKB: tx 0xdef456...</div>
              <br />
              <div>Your code is now permanently backed up and provable.</div>
            </div>
            <div className={styles['hero__terminal-line']}>
              <span className={styles['hero__terminal-prompt']}>~ ❯</span>
              <span className={styles['hero__terminal-cmd']}><span style={{animation: 'pulse 1s infinite'}}>█</span></span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.features} id="features">
        <div className={styles.features__header}>
          <div className={styles.features__label}>The Platform</div>
          <h2 className={styles.features__title}>Censorship-Resistant Code</h2>
          <p className={styles.features__subtitle}>
            Rivet gives you the convenience of centralized platforms with the security and sovereignty of Web3.
          </p>
        </div>

        <div className={styles.features__grid}>
          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--backup']}`}>
              <Database size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>IPFS Mirrors</h3>
            <p className={styles['feature-card__description']}>
              We run a full `git clone --mirror` on your repos and store them on IPFS and Arweave. Every branch, tag, and commit is preserved.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--anchor']}`}>
              <Lock size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>CKB Anchors</h3>
            <p className={styles['feature-card__description']}>
              We compute a Merkle root of your entire history and anchor it on the Nervos CKB blockchain. Immutable and permanent proof.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--restore']}`}>
              <History size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>Perfect Restore</h3>
            <p className={styles['feature-card__description']}>
              Restore to a new GitHub account anytime. We remap your emails so your contribution graph lights up with the original historical dates.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--passport']}`}>
              <ShieldCheck size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>Sovereign Passport</h3>
            <p className={styles['feature-card__description']}>
              Mint your developer identity as an RGB++ Spore DOB. Your reputation belongs to you, not the platform.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--view']}`}>
              <Github size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>Familiar Web UI</h3>
            <p className={styles['feature-card__description']}>
              Browse your backed-up code, files, and commits through our beautiful web interface, just like you would on GitHub.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--verify']}`}>
              <ShieldCheck size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>Public Verification</h3>
            <p className={styles['feature-card__description']}>
              Anyone can verify your authorship by checking your on-chain CKB proof. Cryptographically provable history.
            </p>
          </div>
        </div>
      </section>

      <section className={styles['how-it-works']} id="how-it-works">
        <div className={styles['how-it-works__header']}>
          <h2 className={styles['how-it-works__title']}>How it works</h2>
          <p className={styles['how-it-works__subtitle']}>
            Four steps to permanent code ownership.
          </p>
        </div>

        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--1']}`}>1</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Connect Wallet & Link GitHub</h3>
              <p className={styles.step__description}>
                Log in with MetaMask, JoyID, or UniSat. Your wallet is your identity. Link your GitHub account to import your repositories.
              </p>
            </div>
          </div>

          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--2']}`}>2</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Backup to Decentralized Storage</h3>
              <p className={styles.step__description}>
                With one click, we create full Git mirrors of your selected repos and upload them to IPFS, ensuring the data is always available.
              </p>
              <div className={`${styles.step__tag} ${styles['step__tag--ipfs']}`}>IPFS / Arweave</div>
            </div>
          </div>

          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--3']}`}>3</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Anchor Proof on Blockchain</h3>
              <p className={styles.step__description}>
                We compute a Merkle tree of your commit history and anchor the root to a CKB Cell. This creates an unforgeable timestamp of your work.
              </p>
              <div className={`${styles.step__tag} ${styles['step__tag--ckb']}`}>Nervos CKB</div>
            </div>
          </div>

          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--4']}`}>4</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Restore Anytime</h3>
              <p className={styles.step__description}>
                If you ever lose your GitHub account, use Rivet to push your history to a new account. We map your emails so all original timestamps are preserved.
              </p>
              <div className={`${styles.step__tag} ${styles['step__tag--github']}`}>GitHub API</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.cta__card}>
          <h2 className={styles.cta__title}>Ready to secure your code?</h2>
          <p className={styles.cta__description}>
            Join the developers who own their history. Connect your wallet to get started.
          </p>
          <div className={styles.cta__buttons}>
            <button onClick={handleConnect} className={styles['hero__cta-primary']}>
              Get Started <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footer__inner}>
          <div className={styles.footer__left}>
            <Shield size={16} />
            <span>© 2026 Rivet. All rights reserved.</span>
          </div>
          <div className={styles.footer__links}>
            <Link href="/docs" className={styles.footer__link}>Documentation</Link>
            <Link href="/github" className={styles.footer__link}>GitHub</Link>
            <Link href="/twitter" className={styles.footer__link}>Twitter</Link>
            <Link href="/discord" className={styles.footer__link}>Discord</Link>
          </div>
          <div className={styles.footer__tech}>
            Powered by <img src="https://cryptologos.cc/logos/nervos-network-ckb-logo.svg?v=032" alt="CKB" width="16" height="16" /> Nervos CKB
          </div>
        </div>
      </footer>
    </>
  );
}
