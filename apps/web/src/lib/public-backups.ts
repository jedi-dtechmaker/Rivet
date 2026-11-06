import { prisma, readWithConnectionRetry } from './db';
import { createTestnetClient } from './ckb-server';

const publicBackupWhere = {
  isPrivate: false,
  isBackedUp: true,
  user: { isProfilePublic: true },
  ckbTxHash: { not: null },
  lastBackupCid: { not: null },
};

const publicBackupSelect = {
  id: true, fullName: true, name: true, commitCount: true, updatedAt: true,
  ckbTxHash: true, ckbCellOutpoint: true, lastBackupCid: true,
} as const;

export function findPublicBackups(query: string, page = 1) {
  const search = query.trim().slice(0, 200);
  const safePage = Number.isSafeInteger(page) && page >= 1 && page <= 1000 ? page : 1;
  return readWithConnectionRetry(() => prisma.repository.findMany({
    where: { ...publicBackupWhere, ...(search ? { fullName: { contains: search, mode: 'insensitive' as const } } : {}) },
    select: publicBackupSelect,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    skip: (safePage - 1) * 24,
    take: 25,
  }));
}

export function findPublicBackup(reference: string) {
  const query = reference.trim().slice(0, 200);
  if (!query) return Promise.resolve(null);
  return readWithConnectionRetry(() => prisma.repository.findFirst({
    where: { ...publicBackupWhere, OR: [{ ckbTxHash: query }, { lastBackupCid: query }, { fullName: { equals: query, mode: 'insensitive' } }, { githubRepoId: query }] },
    select: publicBackupSelect,
    orderBy: { updatedAt: 'desc' },
  }));
}

export type PublicBackup = NonNullable<Awaited<ReturnType<typeof findPublicBackup>>>;
export type AnchorCheck = { status: 'confirmed'; root: string; blockHeight: string | null } | { status: 'pending' | 'unavailable' | 'invalid' };

export async function checkPublicBackupAnchor(backup: PublicBackup, client = createTestnetClient()): Promise<AnchorCheck> {
  const parts = backup.ckbCellOutpoint?.split(':');
  const outputIndex = parts?.[1] ? Number(parts[1]) : NaN;
  if (!backup.ckbTxHash || parts?.length !== 2 || parts[0] !== backup.ckbTxHash || !Number.isSafeInteger(outputIndex) || outputIndex < 0) return { status: 'invalid' };
  try {
    const result = await client.getTransaction(backup.ckbTxHash);
    if (result?.status === 'rejected') return { status: 'invalid' };
    if (!result || result.status !== 'committed') return { status: 'pending' };
    if (result.transaction.hash().toLowerCase() !== backup.ckbTxHash.toLowerCase()) return { status: 'invalid' };
    const root = result.transaction.outputsData[outputIndex];
    if (!result.transaction.outputs[outputIndex] || !/^0x[0-9a-f]{64}$/i.test(root || '')) return { status: 'invalid' };
    const header = result.blockHash ? await client.getHeaderByHash(result.blockHash) : undefined;
    return { status: 'confirmed', root, blockHeight: header?.number.toString() || null };
  } catch { return { status: 'unavailable' }; }
}
