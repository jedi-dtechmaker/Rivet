import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { workerAuthorized } from '@/lib/worker-auth';
import { BACKUP_STAGES } from '@/lib/backup-progress';
import { prepareBackupJob } from '@/lib/backup-jobs';

export async function GET(request: Request) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url), id = url.searchParams.get('jobId'), repo = url.searchParams.get('repo');
  if (!id || !repo) return NextResponse.json({ error: 'Missing job reference' }, { status: 400 });
  const job = await prisma.workerDispatch.findUnique({ where: { id } });
  if (!job || job.kind !== 'backup' || job.repository !== repo.toLowerCase()) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const current = await prisma.repository.findFirst({ where: { userId: job.userId, githubRepoId: { equals: repo, mode: 'insensitive' } } });
  const canReuseSnapshot = Boolean(current?.isBackedUp && current.ckbCellOutpoint === job.previousOutpoint
    && current.lastBackupCid && current.githubNumericId && /^[a-f0-9]{64}$/i.test(current.encryptionKey || '')
    && /^[a-f0-9]{24}$/i.test(current.encryptionIv || ''));
  return NextResponse.json({ state: job.state, previousOutpoint: job.previousOutpoint, checkpoint: job.checkpoint,
    canReuseSnapshot, githubNumericId: current?.githubNumericId },
    { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body.jobId !== 'string' || typeof body.repo !== 'string') return NextResponse.json({ error: 'Missing job reference' }, { status: 400 });
    const saved = await prepareBackupJob(body.jobId, body.repo, body.checkpoint);
    return NextResponse.json({ checkpoint: saved }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Could not save this backup transaction. Keep the same job for recovery.' }, { status: 409 }); }
}

/** The shared worker secret authenticates stage updates; values cannot regress. */
export async function PATCH(request: Request) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body.jobId !== 'string' || typeof body.repo !== 'string' ||
        typeof body.stage !== 'string' || !Object.hasOwn(BACKUP_STAGES, body.stage)) {
      return NextResponse.json({ error: 'Invalid progress update' }, { status: 400 });
    }
    const progress = BACKUP_STAGES[body.stage as keyof typeof BACKUP_STAGES].percent;
    await prisma.workerDispatch.updateMany({ where: {
      id: body.jobId, repository: body.repo.toLowerCase(), kind: 'backup',
      state: { in: ['queued', 'prepared'] }, progress: { lt: progress },
    }, data: { progress } });
    return NextResponse.json({ acknowledged: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Could not update backup progress' }, { status: 503 }); }
}
