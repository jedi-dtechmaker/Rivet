'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import styles from './page.module.css';

export function VerifySearchClient({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleSearch = () => {
    if (query.trim()) {
      startTransition(() => router.push(`/verify?q=${encodeURIComponent(query.trim())}`));
    }
  };

  return (
    <form className={styles.search_box} role="search" onSubmit={event => { event.preventDefault(); handleSearch(); }}>
      <Search size={20} className={styles.search_icon} />
      <input 
        type="text" 
        placeholder="Transaction hash, IPFS CID, or owner/repository"
        aria-label="Public backup reference"
        maxLength={200}
        className={styles.search_input} 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" className="btn btn--primary" disabled={pending || !query.trim()} aria-busy={pending}>{pending ? 'Checking…' : 'Look up backup'}</button>
    </form>
  );
}
