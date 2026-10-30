import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Socket } from 'node:net';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export function databaseConnectionUrl(value: string) {
  const url = new URL(value);
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '15');
  return url.toString();
}

export function createDatabaseClient() {
  if (process.env.DATABASE_TRANSPORT && process.env.DATABASE_TRANSPORT !== 'pg') throw new Error('Unsupported database transport.');
  if (process.env.DATABASE_TRANSPORT === 'pg') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    const family = process.env.DATABASE_IP_FAMILY;
    if (family && family !== '4' && family !== '6') throw new Error('DATABASE_IP_FAMILY must be 4 or 6.');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 120000, allowExitOnIdle: true, keepAlive: true, keepAliveInitialDelayMillis: 10000,
      ...(family ? { stream: () => {
        const socket = new Socket();
        const connect = socket.connect.bind(socket);
        // pg still uses the original hostname for TLS/SNI and certificate checks.
        // Only the underlying TCP address selection is constrained.
        socket.connect = ((port: number, host: string) => connect({ port, host, family: Number(family) })) as typeof socket.connect;
        return socket;
      } } : {}),
    });
    pool.on('error', () => console.error('[database] An idle database connection closed.'));
    const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
    return new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  }
  return new PrismaClient(process.env.DATABASE_URL ? {
    datasources: { db: { url: databaseConnectionUrl(process.env.DATABASE_URL) } },
  } : undefined);
}

export const prisma = globalForPrisma.prisma ?? createDatabaseClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function readWithConnectionRetry<Result>(query: () => Promise<Result>): Promise<Result> {
  try {
    return await query();
  } catch (error) {
    const unreachable = error && typeof error === 'object' && (
      ('code' in error && error.code === 'P1001') ||
      ('errorCode' in error && error.errorCode === 'P1001')
    );
    const pgConnectionFailure = error instanceof Error &&
      /^(Connection terminated due to connection timeout|Connection terminated unexpectedly|timeout exceeded when trying to connect)$/.test(error.message);
    if (!unreachable && !pgConnectionFailure) throw error;
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
