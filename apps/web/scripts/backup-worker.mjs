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
  PREVIOUS_OUTPOINT,
} = process.env;

/** Parse an outpoint like "0x<64 hex>:<index>". Returns null if malformed. */
function parseOutpoint(value) {
  if (!value) return null;
  const [txHash, indexStr] = String(value).split(':');
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) return null;
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) return null;
  return { txHash, index };
}

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

    // Reuse the repository's existing anchor cell where possible: spend it and
    // write the new root into a fresh cell (same lock, same capacity). That keeps
    // on-chain growth at one cell per repo instead of one cell per backup, while
    // preserving the simple "one tx = one proof" story.
    const previous = parseOutpoint(PREVIOUS_OUTPOINT);

    const anchor = async (reusePrevious) => {
      const inputs = [];
      let reusedCell = null;

      if (reusePrevious && previous) {
        const outPoint = ccc.OutPoint.from(previous);
        const existing = await client.getCell(outPoint).catch(() => null);

        if (existing) {
          inputs.push(ccc.CellInput.from({ previousOutput: outPoint }));
          reusedCell = existing;
          console.log(`[worker] Reusing anchor cell ${PREVIOUS_OUTPOINT}`);
        } else {
          console.warn(
            `[worker] Anchor cell ${PREVIOUS_OUTPOINT} not found; creating a new one`,
          );
        }
      }

      // Match the existing cell's capacity when reusing, so there is no leftover
      // change beyond the fee.
      const capacity = reusedCell ? reusedCell.cellOutput.capacity : ccc.fixedPointFrom(93);

      const tx = ccc.Transaction.from({
        inputs,
        outputs: [{ lock, capacity }],
        outputsData: [`0x${merkleRoot}`],
      });

      await tx.completeInputsByCapacity(signer);
      await tx.completeFeeBy(signer, 1000);
      const txHash = await signer.sendTransaction(tx);
      return { txHash, reused: Boolean(reusedCell) };
    };

    let anchorResult;
    try {
      anchorResult = await anchor(true);
    } catch (e) {
      if (!previous) throw e;
      // The stored outpoint can be stale: a racing backup may already have spent
      // the cell, and the client can even serve a spent cell from its cache.
      // Falling back to a fresh cell keeps the backup succeeding.
      console.warn(
        `[worker] Could not reuse the anchor cell (${e?.message ?? e}); retrying with a fresh cell`,
      );
      anchorResult = await anchor(false);
    }

    const ckbTxHash = anchorResult.txHash;
    // The anchor is output 0 of this transaction.
    const ckbCellOutpoint = `${ckbTxHash}:0`;
    console.log(
      `[worker] Anchored: ${ckbTxHash} (cell ${ckbCellOutpoint}, ${anchorResult.reused ? 'reused' : 'new'} cell)`,
    );

    await report({
      success: true,
      merkleRoot: `0x${merkleRoot}`,
      ipfsCid,
      ckbTxHash,
      ckbCellOutpoint,
      reusedCell: anchorResult.reused,
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
