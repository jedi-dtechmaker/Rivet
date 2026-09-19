import Link from 'next/link';
import { Search, Compass, Star, TrendingUp, FolderGit2 } from 'lucide-react';
import styles from './page.module.css';

const trendingRepos = [
  { id: 1, name: 'bitcoin-core', owner: 'satoshi', desc: 'Bitcoin Core integration and backups.', stars: 1204, lang: 'C++' },
  { id: 2, name: 'ckb-sdk-js', owner: 'nervosnetwork', desc: 'JavaScript SDK for CKB.', stars: 850, lang: 'TypeScript' },
  { id: 3, name: 'proof-contracts', owner: 'jedi', desc: 'Smart contracts for the PROOF protocol.', stars: 342, lang: 'Rust' },
];

export default function ExplorePage() {
  return (
    <div className={styles.explore_page}>
      <div className={styles.header}>
        <h1 className={styles.title}><Compass size={32} /> Explore PROOF</h1>
        <p className={styles.subtitle}>Discover publicly verified and anchored repositories across the network.</p>
        
        <div className={styles.search_bar}>
          <Search size={20} className={styles.search_icon} />
          <input type="text" placeholder="Search verified repositories, developers, or technologies..." />
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.section_title}><TrendingUp size={20} /> Trending Repositories</h2>
        <div className={styles.grid}>
          {trendingRepos.map(repo => (
            <div key={repo.id} className={styles.repo_card}>
              <div className={styles.repo_header}>
                <Link href={`/${repo.owner}/${repo.name}`} className={styles.repo_name}>
                  {repo.owner} / {repo.name}
                </Link>
                <span className="badge badge--success">Verified</span>
              </div>
              <p className={styles.repo_desc}>{repo.desc}</p>
              <div className={styles.repo_meta}>
                <span className={styles.meta_item}><span className={styles.lang_dot}></span> {repo.lang}</span>
                <span className={styles.meta_item}><Star size={14} /> {repo.stars}</span>
                <span className={styles.meta_item}><FolderGit2 size={14} /> View History</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
