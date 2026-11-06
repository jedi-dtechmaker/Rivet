import type { ReactNode } from 'react';
import styles from './ContentPage.module.css';

export function ContentPage({ title, description, eyebrow = 'Rivet · CKB testnet', actions, children }: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <div className={styles.page}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
    {children}
  </div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.empty}><h2>{title}</h2>{children}</div>;
}
