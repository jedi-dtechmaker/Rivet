import Link from 'next/link';
import { File, Folder, FileCode2, FileText, FileJson } from 'lucide-react';
import { fetchGitHubRepoData } from '@/lib/github';
import styles from './FileTree.module.css';

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

export async function FileTree({ basePath, cachedTree }: { basePath: string, cachedTree?: any }) {
  const repoFullName = basePath.slice(1); // remove leading slash
  let githubData = await fetchGitHubRepoData(repoFullName);

  // If live fetch fails but we have a cached tree in the DB, use it!
  if (!githubData && cachedTree) {
    githubData = typeof cachedTree === 'string' ? JSON.parse(cachedTree) : cachedTree;
  }

  const getIcon = (name: string, type: string) => {
    if (type === 'dir') return <Folder size={16} fill="#475569" color="#475569" />;
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return <FileCode2 size={16} color="#3178c6" />;
    if (name.endsWith('.json')) return <FileJson size={16} color="#f1e05a" />;
    if (name.endsWith('.md')) return <FileText size={16} color="#0099ff" />;
    return <File size={16} color="#64748b" />;
  };

  if (!githubData || !githubData.latestCommit || !Array.isArray(githubData.contents)) {
    return <div className={styles.file_tree} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-dim)' }}>No files found or unable to access GitHub repository.</div>;
  }

  const { latestCommit, contents } = githubData;
  const commit = latestCommit.commit;
  const author = latestCommit.author || { avatar_url: 'https://avatars.githubusercontent.com/u/0?v=4', login: commit.author.name };

  // Sort directories first, then files
  const sortedContents = contents.sort((a: any, b: any) => {
    if (a.type === 'dir' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={styles.file_tree}>
      <div className={styles.tree_header}>
        <div className={styles.commit_info}>
          <img src={author.avatar_url} alt="avatar" className={styles.avatar} />
          <span className={styles.author}>{author.login}</span>
          <span className={styles.message}>{commit.message.split('\n')[0]}</span>
        </div>
        <div className={styles.commit_meta}>
          <span className={styles.hash}>{latestCommit.sha.substring(0, 7)}</span>
          <span className={styles.time}>{timeAgo(commit.author.date)}</span>
        </div>
      </div>

      <div className={styles.tree_body}>
        {sortedContents.map((file: any) => (
          <div key={file.path} className={styles.row}>
            <div className={styles.col_name}>
              {getIcon(file.name, file.type)}
              <Link href={`/${repoFullName}/blob/main/${file.path}`} className={styles.link}>
                {file.name}
              </Link>
            </div>
            <div className={styles.col_message}>
              <span className={styles.truncate}>{file.commitMessage ? file.commitMessage.split('\n')[0] : ''}</span>
            </div>
            <div className={styles.col_time}>{file.commitDate ? timeAgo(file.commitDate) : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
