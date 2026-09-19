'use client';

import { useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { anchorBackupOnChain } from '@/lib/ckb';
import { RefreshCw, ShieldCheck, XCircle, X, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function BackupButton({ repoFullName, isPrivate = false }: { repoFullName: string, isPrivate?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'backing_up' | 'signing' | 'backed_up'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const signer = ccc.useSigner();

  const router = useRouter();
  
  const handleBackup = async () => {
    if (!signer) {
      setErrorMsg("Please connect your CCC wallet first.");
      return;
    }

    try {
      setStatus('backing_up');
      
      // 1. Call our Next.js API route to clone, merkle, and upload to Pinata
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName })
      });
      
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || "Failed to backup repository");
      }

      setStatus('signing');

      // 2. Prompt the user to sign the CKB transaction with the proofs
      const hash = await anchorBackupOnChain(signer, data.merkleRoot, data.ipfsCid, repoFullName);
      setTxHash(hash);
      
      // 3. Save the proofs to our Prisma database
      const ckbAddress = await signer.getRecommendedAddress();
      const updateRes = await fetch('/api/repo/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          repoFullName, 
          ckbTxHash: hash, 
          ipfsCid: data.ipfsCid,
          ckbAddress,
          isPrivate,
          commitCount: data.commitsProcessed,
          cachedTree: data.cachedTree,
          cachedCommits: data.cachedCommits
        })
      });
      
      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save backup record to database");
      }
      
      setStatus('backed_up');
      router.refresh();
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

  if (status === 'backing_up' || status === 'signing') {
    return (
      <span className="badge badge--info" style={{ padding: '4px 8px' }}>
        <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> {status === 'backing_up' ? 'Mirroring to IPFS...' : 'Sign Wallet Tx...'}
      </span>
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
