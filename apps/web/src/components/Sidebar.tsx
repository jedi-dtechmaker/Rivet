'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ccc } from '@ckb-ccc/connector-react';
import { useSession } from 'next-auth/react';
import {
  Book,
  User,
  ShieldCheck,
  Settings,
  LayoutPanelLeft,
  Package,
  Star,
  Fingerprint,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import styles from './Sidebar.module.css';

const groups = [
  {
    label: 'Workspace',
    items: [
      { label: 'Repositories', icon: Book, href: '/dashboard' },
      { label: 'Developer identity', icon: Fingerprint, href: '/dashboard/identity' },
      { label: 'Profile', icon: User, href: '/profile' },
    ],
  },
  {
    label: 'Discover & manage',
    items: [
      { label: 'Verification', icon: ShieldCheck, href: '/verify' },
      { label: 'Projects', icon: LayoutPanelLeft, href: '/dashboard/projects' },
      { label: 'Packages', icon: Package, href: '/dashboard/packages' },
      { label: 'Stars', icon: Star, href: '/dashboard/stars' },
    ],
  },
];

export function Sidebar() {
  const { wallet } = ccc.useCcc();
  const { data: session } = useSession();
  const { isSidebarOpen, setSidebarOpen } = useSidebar();
  const pathname = usePathname();
  const sidebar = useRef<HTMLElement>(null);
  const visible = (!!wallet || !!session) && !['/', '/about', '/explore', '/docs'].includes(pathname);
  const name = session?.user?.name || 'Your workspace';

  useEffect(() => {
    if (!isSidebarOpen || !visible) return;
    const overlay = window.matchMedia('(max-width: 1100px)').matches;
    const previousFocus = document.activeElement;
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || [],
      ).filter(
        (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
      );
    let focusFrame: number | undefined;
    const focusDrawer = () => {
      // The drawer's visibility must be applied before the browser can focus it.
      const first = focusable()[0];
      if (first) first.focus();
      else focusFrame = requestAnimationFrame(focusDrawer);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"]')) return;
      if (event.key === 'Escape') setSidebarOpen(false);
      if (overlay && event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!sidebar.current?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    const previousOverflow = document.body.style.overflow;
    if (overlay) {
      document.body.style.overflow = 'hidden';
      focusFrame = requestAnimationFrame(focusDrawer);
    }
    return () => {
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleEscape);
      if (overlay) document.body.style.overflow = previousOverflow;
      if (overlay && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isSidebarOpen, setSidebarOpen, visible]);

  if (!visible) return null;
  const closeOnMobile = () => {
    if (window.innerWidth <= 1100) setSidebarOpen(false);
  };

  return (
    <>
      {isSidebarOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="app-sidebar"
        aria-label="Workspace navigation"
        inert={!isSidebarOpen}
        className={`${styles.sidebar} ${isSidebarOpen ? styles['sidebar--open'] : ''}`}
      >
        <div className={styles.mobileHeading}>
          <span>Your workspace</span>
          <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation menu">
            <X size={18} />
          </button>
        </div>
        <div className={styles.profile}>
          <div className={styles.avatar}>
            {session?.user?.image ? (
              <img src={session.user.image} alt="" />
            ) : (
              <User size={20} aria-hidden="true" />
            )}
          </div>
          <div className={styles.profileText}>
            <strong>{name}</strong>
            <span>{session ? 'GitHub connected' : 'Wallet connected'}</span>
          </div>
          <span className={styles.connectionDot} aria-hidden="true" />
        </div>
        <nav className={styles.nav} aria-label="Your account">
          {groups.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <p className={styles.groupLabel}>{group.label}</p>
              {group.items.map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={closeOnMobile}
                  className={`${styles.nav_item} ${pathname === href ? styles['nav_item--active'] : ''}`}
                  aria-current={pathname === href ? 'page' : undefined}
                >
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.footer}>
          <Link
            href="/settings"
            onClick={closeOnMobile}
            className={`${styles.nav_item} ${pathname === '/settings' ? styles['nav_item--active'] : ''}`}
            aria-current={pathname === '/settings' ? 'page' : undefined}
          >
            <Settings size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <Link href="/docs" onClick={closeOnMobile} className={styles.guide}>
            A little help, if you need it <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
          <div className={styles.network}>
            <span /> CKB TESTNET <span className={styles.version}>Rivet v0.1</span>
          </div>
        </div>
      </aside>
    </>
  );
}
