import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { workerAuthorized } from '@/lib/worker-auth';
import { completeBackupJob, completeUnchangedBackupJob } from '@/lib/backup-jobs';
import { dispatchBackup, isValidRepoFullName } from '@/lib/backupDispatch';
import { runVellumBackupClaimIssuance } from '@/lib/vellum-backup-claims';

export async function POST(req: NextRequest) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    if (typeof body.jobId !== 'string' || !isValidRepoFullName(body.repoFullName)) return NextResponse.json({ error: 'Missing job reference' }, { status: 409 });
    if (body.success === false) {
      // Prepared bytes may already be on-chain; retain that job's reservation.
      await prisma.workerDispatch.updateMany({ where: { id: body.jobId, repository: body.repoFullName.toLowerCase(), state: 'queued' }, data: { state: 'failed' } });
      return NextResponse.json({ acknowledged: true, success: false });
    }
    if (body.success !== true || !/^0x[a-f0-9]{64}$/i.test(body.ckbTxHash || '')) return NextResponse.json({ error: 'Invalid completion reference' }, { status: 400 });
    const completed = body.unchanged === true
      ? await completeUnchangedBackupJob(body.jobId, body.repoFullName, body.ckbTxHash, body.snapshot)
      : await completeBackupJob(body.jobId, body.repoFullName, body.ckbTxHash);
    if (completed.job.dirty) {
      const user = await prisma.user.findUnique({ where: { id: completed.job.userId } });
      if (user?.autoSync) {
        const followUp = await dispatchBackup(body.repoFullName, user.id, completed.result.ckbCellOutpoint, { deliveryId: `followup:${body.jobId}` });
        if (!followUp.ok) return NextResponse.json({ error: 'Backup saved; follow-up dispatch needs a callback retry.' }, { status: 503 });
      }
    }
    await runVellumBackupClaimIssuance({ userId: completed.job.userId, repository: body.repoFullName }).catch(() => undefined);
    return NextResponse.json({ acknowledged: true, success: true, replayed: completed.replayed,
      ...(body.unchanged === true ? { unchanged: true } : {}) });
  } catch {
    return NextResponse.json({ error: 'Backup completion could not be reconciled. Retry the same job.' }, { status: 409 });
  }
}
