'use client';

import { useState } from 'react';
import { Database, Copy, Check } from 'lucide-react';
import styles from './page.module.css';

export default function CopyAddressClient({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncated = `${address.slice(0, 10)}...${address.slice(-8)}`;

  return (
    <div 
      className={styles.ckb_address} 
      onClick={handleCopy}
      title="Click to copy full address"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', maxWidth: '100%', padding: '6px 12px' }}
    >
      <Database size={14} color="var(--color-brand-primary)" style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {truncated}
      </span>
      {copied ? (
        <Check size={14} color="var(--color-success)" style={{ flexShrink: 0 }} />
      ) : (
        <Copy size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
      )}
    </div>
  );
}
