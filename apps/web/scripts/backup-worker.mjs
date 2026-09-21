/**
 * PROOF backup worker.
 *
 * Runs inside GitHub Actions (which has the `git` binary, a writable disk and a
 * 60 minute budget) because Vercel serverless functions have none of those.
 *
 * Pipeline:
 *   1. git clone --mirror the target repository
 *   2. enumerate every commit hash across all refs
 *   3. compute a Merkle root over those hashes
 *   4. git bundle --all  (a single file with the full history)
 *   5. upload the bundle to IPFS via Pinata
 *   6. anchor the Merkle root on CKB testnet
 *   7. POST the result back to the app
 *
 * Requires env: REPO_FULL_NAME, JOB_ID, CALLBACK_URL, CALLBACK_SECRET,
 *               PINATA_JWT, TREASURY_PRIVATE_KEY
 * Optional env: REPO_CLONE_TOKEN (needed only for private repos)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cryptoJs from 'crypto-js';
import { MerkleTree } from 'merkletreejs';
import { PinataSDK } from 'pinata-web3';

const execFileAsync = promisify(execFile);

const {
  REPO_FULL_NAME,
  JOB_ID,
  CALLBACK_URL,
  CALLBACK_SECRET,
  PINATA_JWT,
  TREASURY_PRIVATE_KEY,
  REPO_CLONE_TOKEN,
} = process.env;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** POST the outcome back to the app. Never throws. */
async function report(payload) {
  if (!CALLBACK_URL) {
    console.error('[worker] No CALLBACK_URL, cannot report result.');
    return;
  }
  try {
    const res = await fetch(CALLBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CALLBACK_SECRET ? { 'x-backup-secret': CALLBACK_SECRET } : {}),
      },
      body: JSON.stringify({ jobId: JOB_ID, repoFullName: REPO_FULL_NAME, ...payload }),
    });
    console.log(`[worker] Callback responded ${res.status}`);
  } catch (e) {
    console.error('[worker] Callback failed:', e?.message ?? e);
  }
}

async function run() {
  if (!REPO_FULL_NAME || !REPO_PATTERN.test(REPO_FULL_NAME)) {
    throw new Error(`Invalid or missing REPO_FULL_NAME: ${REPO_FULL_NAME}`);
  }
  if (!PINATA_JWT) throw new Error('Missing PINATA_JWT');
  if (!TREASURY_PRIVATE_KEY) throw new Error('Missing TREASURY_PRIVATE_KEY');

  const repoName = REPO_FULL_NAME.split('/')[1];
  const cloneUrl = REPO_CLONE_TOKEN
    ? `https://x-access-token:${REPO_CLONE_TOKEN}@github.com/${REPO_FULL_NAME}.git`
    : `https://github.com/${REPO_FULL_NAME}.git`;

  // mkdtemp gives us a unique, writable scratch dir.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rivet-'));
  const bundlePath = path.join(os.tmpdir(), `rivet-${repoName}-${Date.now()}.bundle`);

  try {
    console.log(`[worker] Cloning ${REPO_FULL_NAME} ...`);
    // execFile + arg array: no shell, so repo names cannot inject commands.
    await execFileAsync('git', ['clone', '--mirror', cloneUrl, tmpDir]);

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

    // Identical hashing to the previous in-route implementation, so existing
    // Merkle roots stay reproducible.
    const leaves = commitHashes.map((x) => cryptoJs.SHA256(x).toString());
    const tree = new MerkleTree(leaves, cryptoJs.SHA256);
    const merkleRoot = tree.getRoot().toString('hex');
    console.log(`[worker] Merkle root ${merkleRoot} over ${commitHashes.length} commits`);

    console.log('[worker] Creating bundle ...');
    await execFileAsync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: tmpDir });

    console.log('[worker] Uploading to IPFS ...');
    const fileBuffer = await fs.readFile(bundlePath);
    const blob = new Blob([fileBuffer]);
    const fileObj = new File([blob], `${repoName}.bundle`, {
      type: 'application/octet-stream',
    });
    const pinata = new PinataSDK({ pinataJwt: PINATA_JWT });
    const upload = await pinata.upload.file(fileObj);
    const ipfsCid = upload.IpfsHash;
    console.log(`[worker] IPFS CID ${ipfsCid}`);

    console.log('[worker] Anchoring Merkle root on CKB ...');
    const { ccc } = await import('@ckb-ccc/core');
    const client = new ccc.ClientPublicTestnet();
    const signer = new ccc.SignerCkbPrivateKey(client, TREASURY_PRIVATE_KEY);

    const addresses = await signer.getAddresses();
    // Address.fromString returns a Promise: await it BEFORE reading .script.
    const { script: lock } = await ccc.Address.fromString(addresses[0], client);

    const tx = ccc.Transaction.from({
      outputs: [{ lock, capacity: ccc.fixedPointFrom(93) }],
      outputsData: [`0x${merkleRoot}`],
    });

    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000);
    const ckbTxHash = await signer.sendTransaction(tx);
    console.log(`[worker] Anchored: ${ckbTxHash}`);

    await report({
      success: true,
      merkleRoot: `0x${merkleRoot}`,
      ipfsCid,
      ckbTxHash,
      commitsProcessed: commitHashes.length,
    });
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
  await report({ success: false, error: message });
  process.exit(1);
});
