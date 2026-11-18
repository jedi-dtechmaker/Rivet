import { prisma } from '@/lib/db';

function limit(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) throw new Error('Invalid worker limit configuration.');
  return value;
}

export async function reserveWorkerDispatch(userId: string, id: string, kind: 'backup' | 'restore', backup?: { repository: string; previousOutpoint?: string | null; deliveryId?: string }) {
  const perUser = limit('RIVET_WORKER_USER_HOURLY_LIMIT', 10);
  const perHour = limit('RIVET_WORKER_GLOBAL_HOURLY_LIMIT', 50);
  const perDay = limit('RIVET_WORKER_GLOBAL_DAILY_LIMIT', 200);
  return prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824103)`;
    const repository = backup?.repository.toLowerCase();
    if (repository) {
      if (backup?.deliveryId) {
        const delivered = await transaction.backupDelivery.findUnique({ where: { id: backup.deliveryId } });
        if (delivered) {
          if (delivered.repository !== repository) throw new Error('Webhook delivery belongs to another repository.');
          const job = await transaction.workerDispatch.findUniqueOrThrow({ where: { id: delivered.jobId } });
          if (job.userId !== userId) throw new Error('Backup job belongs to another account.');
          return { allowed: true, error: '', existing: job };
        }
      }
      const active = await transaction.workerDispatch.findFirst({ where: { repository, state: { in: ['queued', 'prepared'] } }, orderBy: { createdAt: 'asc' } });
      if (active) {
        if (active.userId !== userId) throw new Error('Backup job belongs to another account.');
        if (backup?.deliveryId) {
          await transaction.backupDelivery.create({ data: { id: backup.deliveryId, repository, jobId: active.id } });
          await transaction.workerDispatch.update({ where: { id: active.id }, data: { dirty: true } });
        }
        return { allowed: true, error: '', existing: active };
      }
    }
    const now = Date.now();
    const hour = { gte: new Date(now - 3600000) };
    const day = { gte: new Date(now - 86400000) };
    if (await transaction.workerDispatch.count({ where: { userId, createdAt: hour } }) >= perUser) {
      return { allowed: false, error: 'Your hourly backup and restore limit has been reached. Please try again later.' };
    }
    if (await transaction.workerDispatch.count({ where: { createdAt: hour } }) >= perHour ||
        await transaction.workerDispatch.count({ where: { createdAt: day } }) >= perDay) {
      return { allowed: false, error: 'Rivet has reached its worker budget. Please try again later.' };
    }
    let previousOutpoint = backup?.previousOutpoint ?? null;
    if (repository) {
      const current = await transaction.repository.findFirst({ where: { githubRepoId: { equals: repository, mode: 'insensitive' } } });
      if (!current || current.userId !== userId) throw new Error('Backup repository is not registered to this account.');
      // A callback may have advanced the head since the caller read its repository snapshot.
      previousOutpoint = current.ckbCellOutpoint;
    }
    await transaction.workerDispatch.create({ data: { id, userId, kind, ...(repository ? { repository, previousOutpoint } : {}) } });
    if (repository && backup?.deliveryId) await transaction.backupDelivery.create({ data: { id: backup.deliveryId, repository, jobId: id } });
    return { allowed: true, error: '' };
  }, { maxWait: 15000, timeout: 15000 });
}
