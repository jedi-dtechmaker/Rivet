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

    // 1. Prepare temporary directory
    const repoName = repoFullName.split('/')[1];
    const timestamp = Date.now();
    const tmpDir = path.join('/tmp', `rivet-${repoName}-${timestamp}`);
    const bundlePath = `${tmpDir}.bundle`;

    try {
      // 2. Clone the repository as a bare mirror using the OAuth token
      // This ensures we get all branches, tags, and history
      const cloneUrl = `https://x-access-token:${session.accessToken}@github.com/${repoFullName}.git`;
      await execAsync(`git clone --mirror ${cloneUrl} ${tmpDir}`);

      // 3. Extract all commit hashes to build the Merkle Tree
      const { stdout: commitLog } = await execAsync(`cd ${tmpDir} && git log --all --format="%H"`);
      const commitHashes = commitLog.split('\n').filter(Boolean);
      
      if (commitHashes.length === 0) {
        throw new Error("Repository appears to be empty");
      }

      // 4. Compute the Merkle Root
      const leaves = commitHashes.map(x => crypto.SHA256(x).toString());
      const tree = new MerkleTree(leaves, crypto.SHA256);
      const merkleRoot = tree.getRoot().toString('hex');

      // 5. Create a Git Bundle (a single file containing the entire repo history)
      await execAsync(`cd ${tmpDir} && git bundle create ${bundlePath} --all`);

      // 6. Upload the bundle to IPFS via Pinata
      const fileBuffer = await fs.readFile(bundlePath);
      const blob = new Blob([fileBuffer]);
      const fileObj = new File([blob], `${repoName}-${timestamp}.bundle`, { type: 'application/octet-stream' });
      
      const uploadRequest = await pinata.upload.file(fileObj);
      const ipfsCid = uploadRequest.IpfsHash;

      // 6.5 Fetch and cache the file tree for offline decentralized viewing
      const cachedTreeData = await fetchGitHubRepoData(repoFullName);
      const cachedCommitsData = await fetchGitHubCommits(repoFullName);

      // 7. Cleanup temporary files
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.unlink(bundlePath);

      // Return the cryptographic proofs to the client for CKB anchoring
      return NextResponse.json({
        success: true,
        merkleRoot: `0x${merkleRoot}`, // Format as hex string for CKB
        ipfsCid,
        commitsProcessed: commitHashes.length,
        cachedTree: cachedTreeData,
        cachedCommits: cachedCommitsData
      });

    } catch (gitError) {
      // Ensure we clean up even if it fails
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.unlink(bundlePath).catch(() => {});
      throw gitError;
    }

  } catch (error: any) {
    console.error('Backup Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
