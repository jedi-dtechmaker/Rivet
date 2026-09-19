'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { useSession } from 'next-auth/react';
import { Book, LayoutPanelLeft, Package, Star, Copy, Check, User, ShieldCheck } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const { data: session } = useSession();
  const { isSidebarOpen } = useSidebar();
  const [address, setAddress] = useState<string>('Not connected');
  const [copied, setCopied] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (signer) {
      signer.getRecommendedAddress().then(setAddress).catch(() => setAddress('Error'));
    } else {
      setAddress('Not connected');
    }
  }, [signer]);

  const handleCopy = () => {
    if (!address || address === 'Not connected' || address === 'Error') return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortenAddress = (addr: string) => {
    if (!addr || addr === 'Not connected' || addr === 'Error') return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
  };

  const navItems = [
    { label: 'Repositories', icon: <Book size={18} />, href: '/dashboard' },
    { label: 'Profile', icon: <User size={18} />, href: '/profile' },
    { label: 'Verification', icon: <ShieldCheck size={18} />, href: '/verify' },
    { label: 'Projects', icon: <LayoutPanelLeft size={18} />, href: '/dashboard/projects' },
    { label: 'Packages', icon: <Package size={18} />, href: '/dashboard/packages' },
    { label: 'Stars', icon: <Star size={18} />, href: '/dashboard/stars' },
  ];

  const hiddenRoutes = ['/', '/about', '/explore', '/docs'];
  
  // Only render if there's either a connected wallet OR a linked GitHub session
  if (!wallet && !session) return null;
  
  // Do not render sidebar on public static routes
  if (hiddenRoutes.includes(pathname)) return null;

  return (
    <aside className={`${styles.sidebar} ${isSidebarOpen ? styles['sidebar--open'] : ''}`}>
      <div className={styles.profile}>
        <div className={styles.avatar}>
          {session?.user?.image ? (
            <img 
              src={session.user.image} 
              alt="avatar" 
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} 
            />
          ) : (
            <User size={32} color="var(--color-text-tertiary)" />
          )}
        </div>
        
        <div className={styles.wallet_card}>
          <div className={styles.address_info}>
            <span className={styles.address_label}>CKB Wallet</span>
            <span className={styles.address}>{shortenAddress(address)}</span>
          </div>
          <button onClick={handleCopy} className={styles.copy_btn} title="Copy Address">
            {copied ? <Check size={16} color="var(--color-success)" /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => (
          <Link 
            key={item.label} 
            href={item.href}
            className={`${styles.nav_item} ${pathname === item.href ? styles['nav_item--active'] : ''}`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
