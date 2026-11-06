'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { useSession } from 'next-auth/react';
import { Book, Copy, Check, User, ShieldCheck, Settings, LayoutPanelLeft, Package, Star } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const { data: session } = useSession();
  const { isSidebarOpen, setSidebarOpen } = useSidebar();
  const [address, setAddress] = useState<string>('Not connected');
  const [copied, setCopied] = useState(false);
  const pathname = usePathname();
  const sidebar = useRef<HTMLElement>(null);
  const visible = (!!wallet || !!session) && !['/', '/about', '/explore', '/docs'].includes(pathname);

  useEffect(() => {
    if (!isSidebarOpen || !visible) return;
    const overlay = window.matchMedia('(max-width: 1100px)').matches;
    const previousFocus = document.activeElement;
    const focusable = () => Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || []);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"]')) return;
      if (event.key === 'Escape') setSidebarOpen(false);
      if (overlay && event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleEscape);
    const previousOverflow = document.body.style.overflow;
    if (overlay) { document.body.style.overflow = 'hidden'; focusable()[0]?.focus(); }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (overlay) document.body.style.overflow = previousOverflow;
      if (overlay && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isSidebarOpen, setSidebarOpen, visible]);

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
    { label: 'Settings', icon: <Settings size={18} />, href: '/settings' },
  ];

  const hiddenRoutes = ['/', '/about', '/explore', '/docs'];
  
  // Only render if there's either a connected wallet OR a linked GitHub session
  if (!wallet && !session) return null;
  
  // Do not render sidebar on public static routes
  if (hiddenRoutes.includes(pathname)) return null;

  return (
    <>
    {isSidebarOpen && <button type="button" className={styles.backdrop} aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebar} id="app-sidebar" inert={!isSidebarOpen} className={`${styles.sidebar} ${isSidebarOpen ? styles['sidebar--open'] : ''}`}>
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
          <button onClick={handleCopy} className={styles.copy_btn} disabled={address === 'Not connected' || address === 'Error'} aria-label={copied ? 'Wallet address copied' : 'Copy wallet address'}>
            {copied ? <Check size={16} color="var(--color-success)" /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Your account">
        {navItems.map((item) => (
          <Link 
            key={item.label} 
            href={item.href}
            onClick={() => {
              if (window.innerWidth <= 1100) {
                setSidebarOpen(false);
              }
            }}
            className={`${styles.nav_item} ${pathname === item.href ? styles['nav_item--active'] : ''}`}
            aria-current={pathname === item.href ? 'page' : undefined}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
    </aside></>
  );
}
