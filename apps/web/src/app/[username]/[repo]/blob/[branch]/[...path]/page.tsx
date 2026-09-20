import Link from 'next/link';
import { FileCode2, Copy, Download, History, CornerLeftUp } from 'lucide-react';
import styles from './page.module.css';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// We get an array for `path` because of the [...path] catch-all route
export default async function BlobPage({ 
  params 
}: { 
  params: { username: string; repo: string; branch: string; path: string[] } 
}) {
  const filePath = params.path.join('/');
  const basePath = `/${params.username}/${params.repo}`;
  const fullName = `${params.username}/${params.repo}`;

  const session = await getServerSession(authOptions);
  let fileContent = 'Unable to load file content.';
  let fileSize = 0;

  try {
    const headers: any = {
      Accept: 'application/vnd.github.v3.raw',
    };
    if (session && session.accessToken) {
      headers['Authorization'] = `Bearer ${session.accessToken}`;
    }

    const res = await fetch(`https://api.github.com/repos/${fullName}/contents/${filePath}`, { headers });
    
    if (res.ok) {
      fileContent = await res.text();
      fileSize = new Blob([fileContent]).size;
    }
  } catch (e) {
    console.error(e);
  }

  // Count lines for the gutter
  const lineCount = fileContent.split('\n').length;

  return (
    <div className={styles.blob_page}>
      
      {/* File Path Breadcrumb */}
      <div className={styles.breadcrumb}>
        <Link href={basePath} className={styles.breadcrumb_link}>
          <CornerLeftUp size={14} /> Back to {params.repo}
        </Link>
        <span className={styles.breadcrumb_sep}>/</span>
        <span className={styles.current_path}>{filePath}</span>
      </div>

      {/* File Viewer Card */}
      <div className={styles.file_card}>
        <div className={styles.file_header}>
          <div className={styles.file_info}>
            <FileCode2 size={16} className={styles.file_icon} />
            <span className={styles.file_name}>{params.path[params.path.length - 1]}</span>
            <span className={styles.file_meta}>{lineCount} lines • {fileSize} bytes</span>
          </div>
          
          <div className={styles.file_actions}>
            <button className="btn btn--secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>
              <Copy size={14} /> Copy
            </button>
            <button className="btn btn--secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>
              <Download size={14} /> Raw
            </button>
            <button className="btn btn--secondary" style={{ padding: '4px 8px', fontSize: '12px' }}>
              <History size={14} /> History
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className={styles.code_container}>
          <div className={styles.code_gutter}>
            {Array.from({ length: lineCount }).map((_, i) => (
              <div key={i} className={styles.line_number}>{i + 1}</div>
            ))}
          </div>
          <pre className={styles.code_content}>
            <code>{fileContent}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
