import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export function databaseConnectionUrl(value: string) {
  const url = new URL(value);
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '15');
  return url.toString();
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(process.env.DATABASE_URL ? {
    datasources: { db: { url: databaseConnectionUrl(process.env.DATABASE_URL) } },
  } : undefined);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function readWithConnectionRetry<Result>(query: () => Promise<Result>): Promise<Result> {
  try {
    return await query();
  } catch (error) {
    const unreachable = error && typeof error === 'object' && (
      ('code' in error && error.code === 'P1001') ||
      ('errorCode' in error && error.errorCode === 'P1001')
    );
    if (!unreachable) throw error;
    return query();
  }
}

export const db = {
  /**
   * Find a single repository by its GitHub full name (e.g. "owner/repo")
   */
  async findRepo(githubRepoId: string) {
    return prisma.repository.findUnique({
      where: { githubRepoId },
    });
  },

  /**
   * Search for a repository by Tx Hash, IPFS CID, or GitHub ID
   */
  async searchRepoByProof(query: string) {
    if (!query) return null;
    return prisma.repository.findFirst({
      where: {
        OR: [
          { ckbTxHash: query },
          { lastBackupCid: query },
          { githubRepoId: query },
        ]
      }
    });
  },

  /**
   * Get all repositories from our database
   */
  async findAllRepos() {
    try {
      return await prisma.repository.findMany();
    } catch (error) {
      console.error('CRITICAL DB ERROR:', error);
      return [];
    }
  },

  /**
   * Find the first user in the database (for demo purposes)
   */
  async findFirstUser() {
    return prisma.user.findFirst();
  },

  /**
   * Find a user by their GitHub username (handle)
   */
  async findUserByUsername(username: string) {
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) return null;
    return prisma.user.findFirst({
      where: { githubUsername: username },
      include: {
        repositories: {
          orderBy: { updatedAt: 'desc' }
        }
      }
    });
  },

  /**
   * Find a user by their githubId
   */
  async findUserByGithubId(githubId: string) {
    return readWithConnectionRetry(() => prisma.user.findUnique({
      where: { githubId }
    }));
  },

  /**
   * Create a user
   */
  async createUser(data: { githubId: string; githubUsername?: string; ckbAddress?: string }) {
    return prisma.user.create({ data });
  },

  /**
   * Update user settings
   */
  async updateUserSettings(githubId: string, data: { isProfilePublic?: boolean; autoSync?: boolean; bio?: string; ckbAddress?: string }) {
    return prisma.user.update({
      where: { githubId },
      data,
    });
  },

  /**
   * Find repositories by User ID (the UUID, not githubId)
   */
  async findReposByUserId(userId: string) {
    return readWithConnectionRetry(() => prisma.repository.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    }));
  },

  /**
   * Create a new repository record
   */
  async createRepo(data: {
    githubRepoId: string;
    name: string;
    fullName: string;
    isBackedUp: boolean;
    isPrivate: boolean;
    commitCount?: number;
    cachedTree?: any;
    cachedCommits?: any;
    lastBackupCid: string;
    ckbTxHash: string;
    ckbCellOutpoint?: string;
    githubNumericId?: string;
    encryptionKey?: string;
    encryptionIv?: string;
    userId: string;
  }) {
    return prisma.repository.create({
      data: {
        ...data,
        cachedTree: data.cachedTree || null,
        cachedCommits: data.cachedCommits || null,
      },
    });
  },

  /**
   * Update an existing repository with new backup proofs
   */
  async updateRepo(githubRepoId: string, data: {
    isBackedUp: boolean;
    isPrivate?: boolean;
    commitCount?: number;
    cachedTree?: any;
    cachedCommits?: any;
    lastBackupCid: string;
    ckbTxHash: string;
    ckbCellOutpoint?: string;
    encryptionKey?: string;
    encryptionIv?: string;
  }) {
    return prisma.repository.update({
      where: { githubRepoId },
      data: {
        ...data,
        cachedTree: data.cachedTree || undefined,
        cachedCommits: data.cachedCommits || undefined,
      },
    });
  },
};
