import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto-js';
import { MerkleTree } from 'merkletreejs';
import { PinataSDK } from 'pinata-web3';
import { fetchGitHubRepoData, fetchGitHubCommits } from '@/lib/github';
import { db } from '@/lib/db';

const execAsync = promisify(exec);

// Initialize Pinata SDK
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || '',
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { repoFullName } = body;

    if (!repoFullName) {
      return NextResponse.json({ error: 'Missing repoFullName' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendUpdate = (msg: string, progress: number, data?: any) => {
          controller.enqueue(encoder.encode(JSON.stringify({ msg, progress, ...data }) + '\n'));
        };

        const repoName = repoFullName.split('/')[1];
        const timestamp = Date.now();
        const tmpDir = path.join('/tmp', `rivet-${repoName}-${timestamp}`);
        const bundlePath = `${tmpDir}.bundle`;

        try {
          sendUpdate("Initializing secure environment...", 5);

          // 2. Clone the repository
          sendUpdate("Cloning repository mirror...", 15);
          const cloneUrl = `https://x-access-token:${session.accessToken}@github.com/${repoFullName}.git`;
          await execAsync(`git clone --mirror ${cloneUrl} ${tmpDir}`);

          // 3. Extract commits
          sendUpdate("Analyzing commit history...", 30);
          const { stdout: commitLog } = await execAsync(`cd ${tmpDir} && git log --all --format="%H"`);
          const commitHashes = commitLog.split('\n').filter(Boolean);
          
          if (commitHashes.length === 0) {
            throw new Error("Repository appears to be empty");
          }

          // 4. Compute Merkle Root
          sendUpdate("Building Cryptographic Merkle Tree...", 45);
          const leaves = commitHashes.map(x => crypto.SHA256(x).toString());
          const tree = new MerkleTree(leaves, crypto.SHA256);
          const merkleRoot = tree.getRoot().toString('hex');

          // 5. Create Git Bundle
          sendUpdate("Packaging repository bundle...", 55);
          await execAsync(`cd ${tmpDir} && git bundle create ${bundlePath} --all`);

          // 6. Upload to IPFS
          sendUpdate("Uploading proofs to decentralized IPFS...", 65);
          const fileBuffer = await fs.readFile(bundlePath);
          const blob = new Blob([fileBuffer]);
          const fileObj = new File([blob], `${repoName}-${timestamp}.bundle`, { type: 'application/octet-stream' });
          
          const uploadRequest = await pinata.upload.file(fileObj);
          const ipfsCid = uploadRequest.IpfsHash;

          sendUpdate("Caching repository tree data...", 75);
          const cachedTreeData = await fetchGitHubRepoData(repoFullName);
          const cachedCommitsData = await fetchGitHubCommits(repoFullName);

          // 7. Cleanup
          await fs.rm(tmpDir, { recursive: true, force: true });
          await fs.unlink(bundlePath);

          // 8. Anchor on CKB
          sendUpdate("Anchoring Merkle Root on CKB Testnet...", 85);
          let anchoredCkbTxHash = '';
          try {
            const { ccc } = require('@ckb-ccc/core');
            const privateKey = process.env.TREASURY_PRIVATE_KEY;
            if (!privateKey) throw new Error("Missing TREASURY_PRIVATE_KEY");

            const client = new ccc.ClientPublicTestnet();
            const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

            const addresses = await signer.getAddresses();
            const treasuryAddress = addresses[0];
            const { script: lock } = await ccc.Address.fromString(treasuryAddress, client);

            const tx = ccc.Transaction.from({
              outputs: [{
                lock: lock,
                capacity: ccc.fixedPointFrom(93),
              }],
              outputsData: [`0x${merkleRoot}`]
            });

            await tx.completeInputsByCapacity(signer);
            await tx.completeFeeBy(signer, 1000);
            anchoredCkbTxHash = await signer.sendTransaction(tx);
          } catch (ckbError: any) {
            console.error("Failed to anchor Merkle root on CKB:", ckbError);
            throw new Error(`CKB anchoring failed: ${ckbError?.message || String(ckbError)}`);
          }

          sendUpdate("Securing records in database...", 95);
          // 10. Save Database
          const existingRepo = await db.findRepo(repoFullName);
          if (existingRepo) {
            await db.updateRepo(repoFullName, {
              isBackedUp: true,
              ckbTxHash: anchoredCkbTxHash,
              lastBackupCid: ipfsCid,
              commitCount: commitHashes.length,
              cachedTree: cachedTreeData,
              cachedCommits: cachedCommitsData
            });
          } else {
            const githubId = (session.user as any).id;
            const email = session.user?.email;
            let dbUser = await db.findUserByGithubId(githubId);
            
            if (!dbUser && email) {
              dbUser = await db.findUserByGithubId(email);
            }
            if (!dbUser) {
              dbUser = await db.findFirstUser();
            }

            if (dbUser) {
              await db.createRepo({
                 githubRepoId: repoFullName,
                 name: repoName,
                 fullName: repoFullName,
                 isBackedUp: true,
                 isPrivate: false,
                 commitCount: commitHashes.length,
                 cachedTree: cachedTreeData,
                 cachedCommits: cachedCommitsData,
                 lastBackupCid: ipfsCid,
                 ckbTxHash: anchoredCkbTxHash,
                 userId: dbUser.id
              });
            }
          }

          sendUpdate("Backup Complete!", 100, {
            success: true,
            merkleRoot: `0x${merkleRoot}`,
            ipfsCid,
            ckbTxHash: anchoredCkbTxHash,
            commitsProcessed: commitHashes.length,
          });

          controller.close();
        } catch (error: any) {
          // Cleanup
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          await fs.unlink(bundlePath).catch(() => {});
          
          sendUpdate(error.message || "An unexpected error occurred", 0, {
            success: false,
            error: error.message || "An unexpected error occurred"
          });
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform'
      }
    });
  } catch (error: any) {
    console.error('Backup Initialization Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
