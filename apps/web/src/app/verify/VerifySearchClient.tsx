'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import styles from './page.module.css';

export function VerifySearchClient({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  const handleSearch = () => {
    if (query.trim()) {
      router.push(`/verify?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className={styles.search_box}>
      <Search size={20} className={styles.search_icon} />
      <input 
        type="text" 
        placeholder="Search by Tx Hash, IPFS CID, or Repo name..." 
        className={styles.search_input} 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button onClick={handleSearch} className="btn btn--primary" style={{ padding: '8px 24px' }}>Verify</button>
    </div>
  );
}
