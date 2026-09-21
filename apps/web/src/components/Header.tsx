'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Shield, Github, LogOut, User, Settings, ExternalLink, Menu } from 'lucide-react';
import { ccc } from '@ckb-ccc/connector-react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useSidebar } from '@/contexts/SidebarContext';
import styles from './Header.module.css';

export function Header() {
  const { wallet, open, disconnect } = ccc.useCcc();
  const { data: session, status } = useSession();
  const { toggleSidebar } = useSidebar();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const signer = ccc.useSigner();
  const [address, setAddress] = useState<string>('');

  useEffect(() => {
    async function syncWallet() {
      if (signer) {
        try {
          const addr = await signer.getRecommendedAddress();
          setAddress(addr);
          // Automatically fix the demo DB address if needed
          fetch('/api/user/sync-wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ckbAddress: addr })
          }).catch(console.error);
        } catch (e) {
          console.error(e);
        }
      } else {
        setAddress('');
      }
    }
    syncWallet();
  }, [signer]);

  const isWalletConnected = !!wallet;
  const isGithubLinked = !!session;
  
  const truncateAddress = (addr: string) => 
    addr ? `${addr.slice(0, 7)}...${addr.slice(-4)}` : '';

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleWalletDisconnect = () => {
    disconnect();
    setIsDropdownOpen(false);
  };

  const handleGithubDisconnect = () => {
    signOut();
    setIsDropdownOpen(false);
  };

  const hiddenRoutes = ['/', '/about', '/explore', '/docs'];
  const showHamburger = isWalletConnected && !hiddenRoutes.includes(pathname);

  return (
    <header className={styles.header} id="main-header">
      <div className={styles.header__inner}>
        <div className={styles.header__left}>
          {showHamburger && (
            <button className={styles.hamburger} onClick={toggleSidebar} aria-label="Toggle Menu">
              <Menu size={24} />
            </button>
          )}
          <Link href="/" className={styles.header__logo}>
            <div className={styles['header__logo-icon']}>
              <Shield size={18} />
            </div>
            Rivet
          </Link>

          <nav className={styles.header__nav} aria-label="Main navigation">
            <Link href="/explore" className={styles['header__nav-link']}>
              Explore
            </Link>
            <Link href="/verify" className={styles['header__nav-link']}>
              Verify
            </Link>
            <Link href="/docs" className={styles['header__nav-link']}>
              Docs
            </Link>
            <Link href="/about" className={styles['header__nav-link']}>
              About
            </Link>
          </nav>
        </div>

        <div className={styles.header__right}>
          {!isGithubLinked ? (
            <button
              className={styles['header__connect-btn']}
              onClick={() => signIn('github')}
            >
              <Github size={16} style={{ marginRight: '8px' }} />
              Sign in with GitHub
            </button>
          ) : (
            <div className={styles.user_dropdown_container} ref={dropdownRef}>
              <button 
                className={styles.header__user} 
                id="user-menu-btn"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                title="Account Menu"
              >
                <div className={styles.header__avatar}>
                  {session?.user?.image ? (
                    <img 
                      src={session.user.image} 
                      alt="avatar" 
                      style={{ width: '100%', height: '100%', borderRadius: '50%' }} 
                    />
                  ) : (
                    <Github size={16} />
                  )}
                </div>
                <span className={styles.header__username} style={{ display: 'none' }}>
                  {session?.user?.name || session?.user?.email?.split('@')[0]}
                </span>
              </button>

              {isDropdownOpen && (
                <div className={styles.user_dropdown}>
                  <div className={styles.dropdown_header}>
                    <div className={styles.wallet_info}>
                      <span className={styles.wallet_label}>GitHub Account</span>
                      <span className={styles.wallet_address}>
                        @{session?.user?.name || session?.user?.email?.split('@')[0]}
                      </span>
                    </div>
                  </div>

                  <Link href="/dashboard" className={styles.dropdown_item} onClick={() => setIsDropdownOpen(false)}>
                    <User size={14} /> Dashboard
                  </Link>

                  <a 
                    href={`https://github.com/${session?.user?.name || ''}`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className={styles.dropdown_item}
                    onClick={() => setIsDropdownOpen(false)}
                  >
                    <Github size={14} /> GitHub Profile <ExternalLink size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
                  </a>

                  <Link href="/settings" className={styles.dropdown_item} onClick={() => setIsDropdownOpen(false)}>
                    <Settings size={14} /> Settings
                  </Link>

                  {/* Web3 Upgrade Flow */}
                  <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }}></div>
                  
                  {!isWalletConnected ? (
                    <button onClick={open} className={styles.dropdown_item} style={{ color: 'var(--color-primary)' }}>
                      <Shield size={14} /> Upgrade to Web3 (CoTA)
                    </button>
                  ) : (
                    <>
                      <div className={styles.dropdown_item} style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                        Wallet: {truncateAddress(address)}
                      </div>
                      <button onClick={handleWalletDisconnect} className={`${styles.dropdown_item} ${styles['dropdown_item--danger']}`}>
                        <LogOut size={14} /> Disconnect Wallet
                      </button>
                    </>
                  )}
                  
                  <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }}></div>

                  <button onClick={handleGithubDisconnect} className={`${styles.dropdown_item} ${styles['dropdown_item--danger']}`}>
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
