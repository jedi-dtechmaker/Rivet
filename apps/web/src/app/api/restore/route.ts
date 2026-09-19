import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Fetch actual GitHub username using the access token
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      }
    });
    
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch GitHub user profile' }, { status: 400 });
    }
    
    const userData = await userRes.json();
    const username = userData.login;

    if (!username) {
      return NextResponse.json({ error: 'GitHub Username not found' }, { status: 400 });
    }

    const body = await req.json();
    const { ipfsCid, repoName } = body;

    if (!ipfsCid || !repoName) {
      return NextResponse.json({ error: 'Missing ipfsCid or repoName' }, { status: 400 });
    }

    const restoredRepoName = `${repoName}-restored`;
    const timestamp = Date.now();
    const tmpDir = path.join('/tmp', `restore-${repoName}-${timestamp}`);
    const bundlePath = `${tmpDir}.bundle`;

    try {
      // 1. Create temporary directory
      await fs.mkdir(tmpDir, { recursive: true });

      // 2. Create the new repository on GitHub
      const createRepoRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: restoredRepoName,
          description: 'Restored from CKB/IPFS Backup by Rivet',
          private: false, // You could make this configurable
        }),
      });

      if (!createRepoRes.ok) {
        const errorData = await createRepoRes.json();
        throw new Error(`Failed to create GitHub repo: ${errorData.message}`);
      }
      
      const newRepoData = await createRepoRes.json();

      // 3. Download the IPFS bundle
      // Use wget because the bundle could be large
      await execAsync(`wget -O ${bundlePath} https://gateway.pinata.cloud/ipfs/${ipfsCid}`);

      // 4. Unpack the bundle
      await execAsync(`git clone ${bundlePath} ${tmpDir}`);

      // 5. Push to the new GitHub repository
      const pushUrl = `https://x-access-token:${session.accessToken}@github.com/${username}/${restoredRepoName}.git`;
      await execAsync(`cd ${tmpDir} && git remote set-url origin ${pushUrl} && git push --mirror origin`);

      // 6. Cleanup
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.unlink(bundlePath);

      return NextResponse.json({
        success: true,
        restoredUrl: newRepoData.html_url
      });

    } catch (processError: any) {
      // Cleanup on failure
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.unlink(bundlePath).catch(() => {});
      throw processError;
    }

  } catch (error: any) {
    console.error('Restore Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
