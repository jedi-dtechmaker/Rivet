import { prisma } from '@/lib/db';

function limit(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) throw new Error('Invalid worker limit configuration.');
  return value;
}

export async function reserveWorkerDispatch(userId: string, id: string, kind: 'backup' | 'restore') {
  const perUser = limit('RIVET_WORKER_USER_HOURLY_LIMIT', 10);
  const perHour = limit('RIVET_WORKER_GLOBAL_HOURLY_LIMIT', 50);
  const perDay = limit('RIVET_WORKER_GLOBAL_DAILY_LIMIT', 200);
  return prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824103)`;
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
    await transaction.workerDispatch.create({ data: { id, userId, kind } });
    return { allowed: true, error: '' };
  }, { maxWait: 15000, timeout: 15000 });
}
