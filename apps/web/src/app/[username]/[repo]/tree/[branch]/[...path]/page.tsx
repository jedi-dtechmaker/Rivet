import Link from 'next/link';
import { CornerLeftUp, FolderOpen } from 'lucide-react';
import { FileTree } from '@/components/repo/FileTree';
import styles from './page.module.css';

export default async function TreePage({ 
  params 
}: { 
  params: { username: string; repo: string; branch: string; path: string[] } 
}) {
  const dirPath = params.path.join('/');
  const basePath = `/${params.username}/${params.repo}`;

  return (
    <div className={styles.tree_page}>
      
      {/* Directory Breadcrumb */}
      <div className={styles.breadcrumb}>
        <Link href={basePath} className={styles.breadcrumb_link}>
          <CornerLeftUp size={14} /> Back to {params.repo}
        </Link>
        <span className={styles.breadcrumb_sep}>/</span>
        <FolderOpen size={14} className={styles.folder_icon} />
        <span className={styles.current_path}>{dirPath}</span>
      </div>

      <div className={styles.tree_container}>
        <FileTree basePath={basePath} subPath={dirPath} />
      </div>
    </div>
  );
}
