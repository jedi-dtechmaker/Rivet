import { NextResponse } from 'next/server';
import { cliAccount } from '@/lib/cli-auth';
import { prisma } from '@/lib/db';
import { readPublicRepository } from '@/lib/public-repository';
import { dispatchBackup, isValidRepoFullName } from '@/lib/backupDispatch';
export async function POST(request: Request) {
  try {
    const account = await cliAccount(request);
    if (!account) return NextResponse.json({ error: 'Use a GitHub token for an existing Rivet account.' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const name = body.repoFullName;
    if (!isValidRepoFullName(name)) return NextResponse.json({ error: 'Invalid repository.' }, { status: 400 });
    const access = await readPublicRepository(name, account.token);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const repository = access.repository;
    if (String(repository.owner?.id) !== account.user.githubId && !repository.permissions?.push && !repository.permissions?.admin) {
      return NextResponse.json({ error: 'Repository write access is required.' }, { status: 403 });
    }
    const saved = await prisma.repository.upsert({ where: { githubRepoId: name }, update: {}, create: {
      githubRepoId: name, fullName: name, name: name.split('/')[1], userId: account.user.id,
      githubNumericId: String(repository.id), isPrivate: false, isBackedUp: false,
    } });
    if (saved.userId !== account.user.id) return NextResponse.json({ error: 'Repository belongs to another Rivet account.' }, { status: 403 });
    const result = await dispatchBackup(name, account.user.id, saved.ckbCellOutpoint || undefined);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ accepted: true, ...result, repoFullName: name, previousTxHash: saved.ckbTxHash }, { status: 202 });
  } catch { return NextResponse.json({ error: 'Could not start backup. Retry shortly.' }, { status: 503 }); }
}
