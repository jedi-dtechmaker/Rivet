import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db, prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { repoFullName, ckbTxHash, ipfsCid, ckbAddress, isPrivate, commitCount, cachedTree, cachedCommits } = body;

    if (!repoFullName || !ckbTxHash || !ipfsCid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Find or create the repository record
    let repo = await db.findRepo(repoFullName);

    if (!repo) {
      // Update the user's CKB address if it's the default one, or create user
      let user = await db.findFirstUser();
      if (!user) {
        user = await db.createUser({
          ckbAddress: ckbAddress || 'unknown_ckb_address',
          githubId: session.user?.email || 'demo_user',
          githubUsername: session.user?.name || 'Demo User',
        });
      } else if (ckbAddress && user.ckbAddress === 'default_ckb_address_for_demo') {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { ckbAddress }
        });
      }

      repo = await db.createRepo({
        githubRepoId: repoFullName,
        name: repoFullName.split('/')[1],
        fullName: repoFullName,
        isBackedUp: true,
        isPrivate: isPrivate || false,
        commitCount: commitCount || 0,
        cachedTree: cachedTree || null,
        cachedCommits: cachedCommits || null,
        lastBackupCid: ipfsCid,
        ckbTxHash: ckbTxHash,
        userId: user.id
      });
    } else {
      // 2. Update the repository with the new proofs
      repo = await db.updateRepo(repoFullName, {
        isBackedUp: true,
        isPrivate: isPrivate !== undefined ? isPrivate : repo.isPrivate,
        commitCount: commitCount !== undefined ? commitCount : repo.commitCount,
        cachedTree: cachedTree !== undefined ? cachedTree : repo.cachedTree,
        cachedCommits: cachedCommits !== undefined ? cachedCommits : repo.cachedCommits,
        lastBackupCid: ipfsCid,
        ckbTxHash: ckbTxHash,
      });
    }

    return NextResponse.json({ success: true, repo });
  } catch (error: any) {
    console.error('Database Sync Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
