import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import cryptoJs from 'crypto-js';
import { MerkleTree } from 'merkletreejs';
import { PinataSDK } from 'pinata-web3';

const execAsync = promisify(exec);
const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT || '' });
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-hub-signature-256');
    const rawBody = await req.text();

    // 1. Verify Webhook Signature
    if (WEBHOOK_SECRET && signature) {
      const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
      const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
      if (signature !== digest) {
        console.error("Webhook signature mismatch!");
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);

    // Only process 'push' events
    if (req.headers.get('x-github-event') !== 'push') {
      return NextResponse.json({ message: 'Ignored non-push event' });
    }

    const repoFullName = payload.repository?.full_name;
    const githubId = payload.sender?.id?.toString();

    if (!repoFullName || !githubId) {
      return NextResponse.json({ error: 'Invalid payload missing repo or sender' }, { status: 400 });
    }

    // 2. Check Database for Repository and User
    let existingRepo = await db.findRepo(repoFullName);
    let user = await db.findUserByGithubId(githubId);
    
    if (!user) {
      // Fallback for demo environment where githubId might be stored as email
      const allUsers = await db.findAllRepos(); // just to force a db import if needed? No, wait. 
      // Actually we can just findFirstUser since it's a single-tenant local demo setup right now
      user = await db.findFirstUser();
    }

    if (!user) {
      console.log(`Ignoring push for ${repoFullName}: User not tracked.`);
      return NextResponse.json({ message: 'Not tracked' });
    }

    // If repo doesn't exist, we should create it during auto-sync so it gets tracked!
    if (!existingRepo) {
      existingRepo = await db.createRepo({
         githubRepoId: repoFullName,
         name: repoFullName.split('/')[1],
         fullName: repoFullName,
         isBackedUp: false,
         isPrivate: false,
         lastBackupCid: '',
         ckbTxHash: '',
         userId: user.id
      });
    }

    // 3. Check Auto-Sync Preference
    if (!user.autoSync) {
      console.log(`Ignoring push for ${repoFullName}: Auto-Sync is OFF for user ${user.githubUsername}.`);
      return NextResponse.json({ message: 'Auto-Sync is disabled' });
    }

    console.log(`[Auto-Sync] Triggering autonomous backup for ${repoFullName}...`);

    // 4. Execute Autonomous Backup (Similar to /api/backup)
    const repoName = repoFullName.split('/')[1];
    const timestamp = Date.now();
    const tmpDir = path.join('/tmp', `rivet-auto-${repoName}-${timestamp}`);
    const bundlePath = `${tmpDir}.bundle`;

    try {
      // NOTE: For private repos, a PAT or App token is required here. 
      // This assumes public access or a globally configured git credential on the server.
      const cloneUrl = `https://github.com/${repoFullName}.git`;
      await execAsync(`git clone --mirror ${cloneUrl} ${tmpDir}`);

      const { stdout: commitLog } = await execAsync(`cd ${tmpDir} && git log --all --format="%H"`);
      const commitHashes = commitLog.split('\n').filter(Boolean);
      
      if (commitHashes.length === 0) throw new Error("Empty repo");

      const leaves = commitHashes.map(x => cryptoJs.SHA256(x).toString());
      const tree = new MerkleTree(leaves, cryptoJs.SHA256);
      const merkleRoot = tree.getRoot().toString('hex');

      await execAsync(`cd ${tmpDir} && git bundle create ${bundlePath} --all`);

      const fileBuffer = await fs.readFile(bundlePath);
      const blob = new Blob([fileBuffer]);
      const fileObj = new File([blob], `${repoName}-${timestamp}.bundle`, { type: 'application/octet-stream' });
      
      const uploadRequest = await pinata.upload.file(fileObj);
      const ipfsCid = uploadRequest.IpfsHash;

      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.unlink(bundlePath).catch(() => {});

      // 5. Anchor the Merkle Root on CKB Testnet using Treasury Wallet
      let anchoredCkbTxHash = '';
      try {
        const { ccc } = require('@ckb-ccc/core');
        const privateKey = process.env.TREASURY_PRIVATE_KEY;
        if (!privateKey) throw new Error("Missing TREASURY_PRIVATE_KEY");

        const client = new ccc.ClientPublicTestnet();
        const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

        const addresses = await signer.getAddresses();
        const treasuryAddress = addresses[0];
        // NOTE: Address.fromString returns a Promise. Destructure AFTER awaiting.
        const { script: lock } = await ccc.Address.fromString(treasuryAddress, client);

        console.log(`[Auto-Sync Backup] Anchoring Merkle Root ${merkleRoot} to CKB...`);
        const tx = ccc.Transaction.from({
          outputs: [{
            lock: lock,
            capacity: ccc.fixedPointFrom(93), // Capacity needed for 32 bytes data
          }],
          outputsData: [`0x${merkleRoot}`]
        });

        await tx.completeInputsByCapacity(signer);
        await tx.completeFeeBy(signer, 1000);
        anchoredCkbTxHash = await signer.sendTransaction(tx);
        console.log(`[Auto-Sync Backup] Successfully anchored to CKB! TxHash: ${anchoredCkbTxHash}`);
      } catch (ckbError: any) {
        // Never fabricate a tx hash. Report the real failure instead of storing
        // a proof that does not exist on-chain.
        console.error("[Auto-Sync] Failed to anchor Merkle root on CKB:", ckbError);
        return NextResponse.json(
          { error: 'CKB anchoring failed', detail: ckbError?.message ?? String(ckbError), ipfsCid },
          { status: 502 }
        );
      }

      // 6. Update Database
      await db.updateRepo(repoFullName, {
        isBackedUp: true,
        ckbTxHash: anchoredCkbTxHash,
        lastBackupCid: ipfsCid,
        commitCount: commitHashes.length,
      });

      console.log(`[Auto-Sync] Successfully backed up ${repoFullName} to ${ipfsCid} and anchored at ${anchoredCkbTxHash}`);
      return NextResponse.json({ success: true, ipfsCid, ckbTxHash: anchoredCkbTxHash });

    } catch (gitError) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      console.error("[Auto-Sync] Error during background backup:", gitError);
      return NextResponse.json({ error: 'Backup failed' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
