/**
 * Rivet backup worker.
 *
 * Runs inside GitHub Actions (which has the `git` binary, a writable disk and a
 * 60 minute budget) because Vercel serverless functions have none of those.
 *
 * Pipeline:
 *   1. git clone --mirror the target repository
 *   2. enumerate every commit hash across all refs
 *   3. compute a Merkle root over sorted commit IDs and a sorted refs hash
 *   4. git bundle --all  (a single file with the full history)
 *   5. upload the bundle to IPFS via Pinata
 *   6. anchor commits, refs, plaintext bundle SHA-256, encrypted CID and count on CKB testnet
 *   7. POST the result back to the app
 *
 * Requires env: REPO_FULL_NAME, JOB_ID, CALLBACK_URL, CALLBACK_SECRET,
 *               PINATA_JWT, TREASURY_PRIVATE_KEY
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PinataSDK } from 'pinata-web3';
import { commitRoot } from '../../../packages/cli/src/proof.mjs';
import { encodeBackupAnchor, refsCommitment, sha256 } from '../../../packages/cli/src/anchor.mjs';
import { createBackupAnchorTransaction, findUnchangedBackup } from './backup-anchor.mjs';
import { retryRead, responseError } from '../../../packages/cli/src/retry.mjs';
import { submitSavedTransaction } from '../../../packages/cli/src/submission.mjs';
import { createCkbClient } from '../../../packages/cli/src/ckb-client.mjs';

const execFileAsync = promisify(execFile);

const {
  REPO_FULL_NAME,
  JOB_ID,
  CALLBACK_URL,
  CALLBACK_SECRET,
  PINATA_JWT,
  TREASURY_PRIVATE_KEY,
} = process.env;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function jobRequest(method, payload) {
  const url = new URL('/api/backup/job', CALLBACK_URL);
  if (method === 'GET') { url.searchParams.set('jobId', JOB_ID); url.searchParams.set('repo', REPO_FULL_NAME); }
  return retryRead(async () => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-backup-secret': CALLBACK_SECRET },
      ...(payload ? { body: JSON.stringify({ jobId: JOB_ID, repo: REPO_FULL_NAME, checkpoint: payload }) } : {}), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw responseError(response, `Backup checkpoint request failed (${response.status}).`);
    return response.json();
  });
}

/** Callback replay is idempotent; retain saved jobs if delivery is interrupted. */
async function report(payload) {
  if (!CALLBACK_URL) {
    console.error('[worker] No CALLBACK_URL, cannot report result.');
    return;
  }
  return retryRead(async () => {
    const res = await fetch(CALLBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CALLBACK_SECRET ? { 'x-backup-secret': CALLBACK_SECRET } : {}),
      },
      body: JSON.stringify({ jobId: JOB_ID, repoFullName: REPO_FULL_NAME, ...payload }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw responseError(res, `Backup callback failed (${res.status}).`);
    console.log(`[worker] Callback responded ${res.status}`);
  });
}

// Progress is best effort and cannot interrupt an otherwise recoverable backup.
async function progress(stage) {
  try {
    const response = await fetch(new URL('/api/backup/job', CALLBACK_URL), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-backup-secret': CALLBACK_SECRET },
      body: JSON.stringify({ jobId: JOB_ID, repo: REPO_FULL_NAME, stage }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) console.warn('[worker] Progress update unavailable.');
  } catch { console.warn('[worker] Progress update unavailable.'); }
}

async function resume(saved) {
  await progress('confirming');
  const { ccc } = await import('@ckb-ccc/core');
  const client = createCkbClient(ccc, process.env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/');
  if ((await client.requestor.request('get_blockchain_info', [])).chain !== 'ckb_testnet') throw new Error('Backup anchoring requires CKB testnet.');
  const transaction = ccc.Transaction.fromBytes(saved.signedTransaction);
  if (transaction.hash() !== saved.txHash) throw new Error('Saved transaction hash mismatch.');
  await submitSavedTransaction({ txHash: saved.txHash, lookup: () => client.getTransactionNoCache(saved.txHash),
    broadcast: () => client.sendTransaction(transaction), polls: 180 });
  await report({ success: true, ckbTxHash: saved.txHash });
  console.log(`[worker] Confirmed ${saved.txHash}; recovery checkpoint retained.`);
}

async function run() {
  if (!REPO_FULL_NAME || !REPO_PATTERN.test(REPO_FULL_NAME)) {
    throw new Error(`Invalid or missing REPO_FULL_NAME: ${REPO_FULL_NAME}`);
  }
  if (!JOB_ID || !CALLBACK_URL || !CALLBACK_SECRET) throw new Error('Missing durable backup job configuration.');
  const job = await jobRequest('GET');
  if (job.state === 'unchanged') {
    await report({ success: true, unchanged: true, ckbTxHash: job.checkpoint.txHash, snapshot: job.checkpoint.snapshot });
    return;
  }
  if (job.checkpoint) { await resume(job.checkpoint); return; }
  if (job.state !== 'queued') throw new Error('Backup job is not queued. Start a new backup.');
  if (!PINATA_JWT) throw new Error('Missing PINATA_JWT');
  if (!TREASURY_PRIVATE_KEY) throw new Error('Missing TREASURY_PRIVATE_KEY');

  const repositoryResponse = await fetch(`https://api.github.com/repos/${REPO_FULL_NAME}`, {
    headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
  });
  if (!repositoryResponse.ok) throw new Error('Only public repositories can be backed up on testnet.');
  const repository = await repositoryResponse.json();
  const githubNumericId = Number.isSafeInteger(repository.id) && repository.id > 0 ? String(repository.id) : undefined;
  if (repository.private !== false || repository.full_name?.toLowerCase() !== REPO_FULL_NAME.toLowerCase()) {
    throw new Error('Only public repositories can be backed up on testnet.');
  }

  const repoName = REPO_FULL_NAME.split('/')[1];
  const cloneUrl = `https://github.com/${REPO_FULL_NAME}.git`;

  // mkdtemp gives us a unique, writable scratch dir.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rivet-'));
  const bundlePath = path.join(os.tmpdir(), `rivet-${repoName}-${Date.now()}.bundle`);

  try {
    await progress('cloning');
    console.log(`[worker] Cloning ${REPO_FULL_NAME} ...`);
    // execFile + arg array: no shell, so repo names cannot inject commands.
    await execFileAsync('git', ['clone', '--mirror', cloneUrl, tmpDir]);

    await progress('history');
    console.log('[worker] Enumerating commits ...');
    const { stdout: commitLog } = await execFileAsync(
      'git',
      ['log', '--all', '--format=%H'],
      { cwd: tmpDir, maxBuffer: 64 * 1024 * 1024 },
    );
    const commitHashes = commitLog.split('\n').map((l) => l.trim()).filter(Boolean);

    if (commitHashes.length === 0) {
      throw new Error('Repository appears to be empty (no commits)');
    }

    // V2 sorts object IDs so Git's traversal order cannot change the commitment.
    const merkleRoot = commitRoot(commitHashes.sort());
    const { stdout: refs } = await execFileAsync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: tmpDir, maxBuffer: 64 * 1024 * 1024 });
    const refsHash = refsCommitment(refs.trim().split('\n'));
    console.log(`[worker] Merkle root ${merkleRoot} over ${commitHashes.length} commits`);

    if (job.canReuseSnapshot && job.githubNumericId === githubNumericId) {
      const snapshot = { merkleRoot, refsHash, commitCount: commitHashes.length, githubNumericId };
      const { ccc } = await import('@ckb-ccc/core');
      const client = createCkbClient(ccc, process.env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/');
      if ((await client.requestor.request('get_blockchain_info', [])).chain !== 'ckb_testnet') throw new Error('Backup anchoring requires CKB testnet.');
      const unchanged = await findUnchangedBackup({ client, previousOutpoint: job.previousOutpoint, snapshot });
      if (unchanged) {
        await report({ success: true, unchanged: true, ckbTxHash: unchanged.txHash, snapshot });
        console.log(`[worker] History and refs are unchanged; reusing ${unchanged.txHash} without another upload or transaction.`);
        return;
      }
    }

    await progress('bundling');
    console.log('[worker] Creating bundle ...');
    await execFileAsync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: tmpDir });

    await progress('encrypting');
    console.log('[worker] Encrypting bundle ...');
    const fileBuffer = await fs.readFile(bundlePath);
    const bundleSha256 = sha256(fileBuffer);
    
    // Generate AES-256-GCM key and IV
    const encryptionKey = crypto.randomBytes(32);
    const encryptionIv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, encryptionIv);
    
    const encryptedBuffer = Buffer.concat([
      cipher.update(fileBuffer),
      cipher.final(),
      cipher.getAuthTag()
    ]);
    
    await progress('uploading');
    console.log('[worker] Uploading encrypted bundle to IPFS ...');
    const blob = new Blob([encryptedBuffer]);
    const fileObj = new File([blob], `${repoName}.bundle`, {
      type: 'application/octet-stream',
    });
    const pinata = new PinataSDK({ pinataJwt: PINATA_JWT });
    const upload = await pinata.upload.file(fileObj);
    const ipfsCid = upload.IpfsHash;
    console.log(`[worker] IPFS CID ${ipfsCid}`);

    const anchorData = encodeBackupAnchor({ merkleRoot, refsHash, bundleSha256, commitCount: commitHashes.length, ipfsCid });
    await progress('anchoring');
    console.log('[worker] Anchoring commits, refs, bundle bytes and CID on CKB ...');
    const { ccc } = await import('@ckb-ccc/core');
    const client = createCkbClient(ccc, process.env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/');
    if ((await client.requestor.request('get_blockchain_info', [])).chain !== 'ckb_testnet') throw new Error('Backup anchoring requires CKB testnet.');
    const signer = new ccc.SignerCkbPrivateKey(client, TREASURY_PRIVATE_KEY);

    const addresses = await signer.getAddresses();
    // Address.fromString returns a Promise: await it BEFORE reading .script.
    const { script: lock } = await ccc.Address.fromString(addresses[0], client);

    // A legacy cell is enlarged to the occupied capacity of the new payload.
    // A stale predecessor or uncertain send must be reconciled, never replaced
    // by an unrelated fresh cell on a second submission attempt.
    const { transaction: tx, reused } = await createBackupAnchorTransaction({ client, lock, previousOutpoint: job.previousOutpoint || undefined, anchorData });
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000);
    const signed = await signer.signTransaction(tx);
    const ckbTxHash = signed.hash(), ckbCellOutpoint = `${ckbTxHash}:0`;
    const saved = await jobRequest('POST', { signedTransaction: signed.toHex(), txHash: ckbTxHash, result: {
      ...(githubNumericId ? { githubNumericId } : {}),
      merkleRoot,
      ipfsCid,
      ckbTxHash,
      ckbCellOutpoint,
      reusedCell: reused,
      commitsProcessed: commitHashes.length,
      encryptionKey: encryptionKey.toString('hex'),
      encryptionIv: encryptionIv.toString('hex'),
    } });
    // The server returns the winning checkpoint if two attempts reached preparation.
    await resume(saved.checkpoint);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(bundlePath).catch(() => {});
  }
}

run().catch(async (error) => {
  // Redact any embedded credentials before logging / reporting.
  const message = String(error?.message ?? error).replace(
    /x-access-token:[^@]+@/g,
    'x-access-token:***@',
  );
  console.error('[worker] FAILED:', message);
  await report({ success: false, error: 'Backup interrupted. Resume the same saved job if a transaction was prepared.' }).catch(() => {
    console.error('[worker] Failure callback could not be delivered; saved job remains available for reconciliation.');
  });
  process.exit(1);
});
