import { GitCommit } from 'lucide-react';
import { db } from '@/lib/db';
import { fetchGitHubCommits } from '@/lib/github';
import styles from './commits.module.css';

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} months ago`;
  return `${Math.floor(months / 12)} years ago`;
}

export default async function CommitsPage({ params }: { params: { username: string; repo: string } }) {
  const fullName = `${params.username}/${params.repo}`;
  const repo = await db.findRepo(fullName);

  let commitsData = await fetchGitHubCommits(fullName);

  // If live fetch fails but we have a cached history in the DB, use it!
  if (!commitsData && repo?.cachedCommits) {
    commitsData = typeof repo.cachedCommits === 'string' ? JSON.parse(repo.cachedCommits) : repo.cachedCommits;
  }

  if (!commitsData || !Array.isArray(commitsData)) {
    return (
      <div className={styles.commits_page} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-dim)' }}>
        No commits found or unable to access repository data.
      </div>
    );
  }

  return (
    <div className={styles.commits_page}>
      <div className={styles.timeline}>
        {commitsData.map((item: any, index: number) => {
          const commit = item.commit;
          const authorLogin = item.author?.login || commit.author.name;
          const authorAvatar = item.author?.avatar_url || 'https://avatars.githubusercontent.com/u/0?v=4';
          const hash = item.sha;
          const shortHash = hash.substring(0, 7);
          const message = commit.message.split('\n')[0];
          const date = timeAgo(commit.author.date);
          const verified = commit.verification?.verified;

          return (
            <div key={hash} className={styles.commit_item}>
              <div className={styles.commit_icon_wrapper}>
                <GitCommit size={20} className={styles.commit_icon} />
                {index !== commitsData.length - 1 && <div className={styles.commit_line}></div>}
              </div>
              
              <div className={styles.commit_content}>
                <div className={styles.commit_header}>
                  <span className={styles.commit_message}>{message}</span>
                  <button className="btn btn--secondary" style={{ padding: '2px 8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                    {shortHash}
                  </button>
                </div>
                
                <div className={styles.commit_meta}>
                  <img src={authorAvatar} alt="avatar" className={styles.avatar} />
                  <span className={styles.author}>{authorLogin}</span>
                  <span className={styles.date}>committed {date}</span>
                  
                  {verified && (
                    <span className={styles.verified_badge}>Verified</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
