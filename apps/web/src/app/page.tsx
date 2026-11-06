'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Github, Lock, History, Database, ShieldCheck, Shield, ChevronRight } from 'lucide-react';
import { signIn, useSession } from 'next-auth/react';
import styles from './page.module.css';

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();

  const handleConnect = () => {
    if (session) {
      router.push('/dashboard');
    } else {
      signIn('github');
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
          Powered by Nervos CKB & CoTA
        </div>

        <h1 className={styles.hero__title}>
          Your Code. Your History. <br />
          <span className={styles['hero__title-highlight']}>Your Backup Plan.</span>
        </h1>

        <p className={styles.hero__subtitle}>
          Back up your public GitHub repositories, keep proof of their history on CKB testnet, and prepare for recovery. Get started without a wallet.
        </p>

        <div className={styles.hero__cta}>
          <button onClick={handleConnect} className={styles['hero__cta-primary']}>
            {session ? 'Go to Dashboard' : 'Sign in with GitHub'} <ArrowRight size={18} />
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
            <div className={styles['hero__terminal-title']}>Your backup, step by step</div>
          </div>
          <div className={styles['hero__terminal-body']}>
            <div className={styles['hero__terminal-line']}>
              <span className={styles['hero__terminal-prompt']}>~ ❯</span>
              <span className={styles['hero__terminal-cmd']}>Choose a public repository → Back up now</span>
            </div>
            <div className={styles['hero__terminal-output']}>
              <div>1. Mirror the repository’s Git history</div>
              <div>2. Save a backup bundle through IPFS</div>
              <div>3. Record its commit-set proof on CKB testnet</div>
              <div>4. Keep the backup references for recovery</div>
              <br />
              <div>No wallet needed. Rivet covers the backup anchor fee.</div>
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
              Rivet mirrors your repository and stores a Git bundle through IPFS, including its commits, branches, and tags.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--anchor']}`}>
              <Lock size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>CKB Anchors</h3>
            <p className={styles['feature-card__description']}>
              A commitment to your backup’s commit set is recorded on CKB testnet, giving you a blockchain checkpoint for that snapshot.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--restore']}`}>
              <History size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>Recovery Tools</h3>
            <p className={styles['feature-card__description']}>
              Recover saved Git history through repository restore controls or the source CLI. Exact local restore is available; attribution remapping is in development.
            </p>
          </div>

          <div className={styles['feature-card']}>
            <div className={`${styles['feature-card__icon']} ${styles['feature-card__icon--passport']}`}>
              <ShieldCheck size={24} />
            </div>
            <h3 className={styles['feature-card__title']}>Sovereign Passport</h3>
            <p className={styles['feature-card__description']}>
              Optionally mint a Spore developer passport owned by your JoyID wallet. It records your verified identity snapshot on CKB testnet.
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
              Look up public backup anchors and inspect developer identity proofs. Check what a proof establishes before relying on it.
            </p>
          </div>
        </div>
      </section>

      <section className={styles['how-it-works']} id="how-it-works">
        <div className={styles['how-it-works__header']}>
          <h2 className={styles['how-it-works__title']}>How it works</h2>
          <p className={styles['how-it-works__subtitle']}>
            A backup workflow you can understand.
          </p>
        </div>

        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--1']}`}>1</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Sign In with GitHub</h3>
              <p className={styles.step__description}>
                Log in instantly with your GitHub account. No crypto wallet or seed phrases required to get started. We handle the Web3 complexity in the background.
              </p>
            </div>
          </div>

          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--2']}`}>2</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Backup to Decentralized Storage</h3>
              <p className={styles.step__description}>
                Start a backup of a public repository. Rivet mirrors its Git history and saves a bundle through IPFS.
              </p>
              <div className={`${styles.step__tag} ${styles['step__tag--ipfs']}`}>Git bundle / IPFS</div>
            </div>
          </div>

          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--3']}`}>3</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Anchor Proof on Blockchain</h3>
              <p className={styles.step__description}>
                Rivet records a commitment to the backup’s commit set on CKB testnet. A separate wallet-owned CoTA identity is optional.
              </p>
              <div className={`${styles.step__tag} ${styles['step__tag--ckb']}`}>Nervos CKB</div>
            </div>
          </div>

          <div className={styles.step}>
            <div className={`${styles.step__number} ${styles['step__number--4']}`}>4</div>
            <div className={styles.step__content}>
              <h3 className={styles.step__title}>Prepare for Recovery</h3>
              <p className={styles.step__description}>
                Inspect your saved backup and export a private recovery file with the source CLI. Test a restore before you need it.
              </p>
              <div className={`${styles.step__tag} ${styles['step__tag--github']}`}>Restore / recovery guide</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.cta__card}>
          <h2 className={styles.cta__title}>Ready to secure your code?</h2>
          <p className={styles.cta__description}>
            Join the developers who own their history. Sign in with GitHub to get started.
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
            <a href="https://github.com/jedi-dtechmaker/Rivet" target="_blank" rel="noreferrer" className={styles.footer__link}>GitHub</a>
            <a href="https://talk.nervos.org/t/dis-rivet-decentralized-github-backup-timestamping-and-restore-on-ckb/10739" target="_blank" rel="noreferrer" className={styles.footer__link}>Community</a>
            <Link href="/about" className={styles.footer__link}>About Rivet</Link>
          </div>
          <div className={styles.footer__tech}>
            Powered by <img src="https://cryptologos.cc/logos/nervos-network-ckb-logo.svg?v=032" alt="CKB" width="16" height="16" /> Nervos CKB
          </div>
        </div>
      </footer>
    </>
  );
}
