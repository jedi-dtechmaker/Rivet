import { timingSafeEqual } from 'node:crypto';

export function workerAuthorized(request: Request) {
  const expected = process.env.BACKUP_CALLBACK_SECRET || process.env.NEXTAUTH_SECRET;
  const provided = request.headers.get('x-backup-secret');
  if (!expected || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
