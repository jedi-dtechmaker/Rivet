import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { workerAuthorized } from '@/lib/worker-auth';
import { prepareBackupJob } from '@/lib/backup-jobs';

export async function GET(request: Request) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url), id = url.searchParams.get('jobId'), repo = url.searchParams.get('repo');
  if (!id || !repo) return NextResponse.json({ error: 'Missing job reference' }, { status: 400 });
  const job = await prisma.workerDispatch.findUnique({ where: { id } });
  if (!job || job.kind !== 'backup' || job.repository !== repo.toLowerCase()) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({ state: job.state, previousOutpoint: job.previousOutpoint, checkpoint: job.checkpoint },
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
