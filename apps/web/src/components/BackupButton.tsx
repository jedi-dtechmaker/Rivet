'use client';

import { useState } from 'react';
import { RefreshCw, ShieldCheck, X, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function BackupButton({ repoFullName, isPrivate = false }: { repoFullName: string, isPrivate?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'backing_up' | 'backed_up'>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const router = useRouter();
  
  const handleBackup = async () => {
    try {
      setStatus('backing_up');
      setProgress(0);
      setStatusText('Connecting...');
      
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName, isPrivate })
      });
      
      if (!res.ok && !res.body) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to start backup process");
      }

      if (!res.body) throw new Error("No response stream available");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            
            if (data.msg) setStatusText(data.msg);
            if (data.progress !== undefined) setProgress(data.progress);
            
            if (data.success === true) {
              setTxHash(data.ckbTxHash);
              setStatus('backed_up');
              router.refresh();
              return; // Exit processing on success
            } else if (data.success === false) {
              throw new Error(data.error || "An error occurred during backup");
            }
          } catch (e: any) {
            // Ignore JSON parse errors for incomplete chunks (handled by buffer)
            // But re-throw application errors
            if (e.message !== "Unexpected end of JSON input" && !e.message.includes("JSON")) {
               throw e;
            }
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "An unexpected error occurred during the backup process.");
      setStatus('idle');
    }
  };

  if (status === 'backed_up') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span className="badge badge--success" style={{ padding: '4px 8px' }}>
          <ShieldCheck size={12} /> Anchored
        </span>
        <a href={`https://pudge.explorer.nervos.org/transaction/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: '10px', color: 'var(--color-primary)' }}>
          View TX
        </a>
      </div>
    );
  }

  if (status === 'backing_up') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '150px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--color-text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
            <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} /> 
            {statusText || 'Initializing...'}
          </span>
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{progress}%</span>
        </div>
        <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ 
            height: '100%', 
            width: `${progress}%`, 
            backgroundColor: 'var(--color-primary)', 
            transition: 'width 0.3s ease',
            boxShadow: '0 0 8px var(--color-primary)'
          }} />
        </div>
      </div>
    );
  }

  return (
    <>
      <button 
        onClick={handleBackup} 
        className="btn btn--secondary" 
        style={{ padding: '4px 12px', fontSize: '12px' }}
      >
        Backup Now
      </button>

      {/* Premium Error Modal Overlay */}
      {errorMsg && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '400px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)', position: 'relative'
          }}>
            <button 
              onClick={() => setErrorMsg(null)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', color: '#ff4d4f' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text)' }}>Action Required</h3>
            </div>
            <p style={{ color: 'var(--color-text-dim)', lineHeight: 1.5, margin: 0, marginBottom: '24px' }}>
              {errorMsg}
            </p>
            <button 
              onClick={() => setErrorMsg(null)}
              className="btn btn--primary" style={{ width: '100%', justifyContent: 'center' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
