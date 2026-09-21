import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

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
    return prisma.user.findUnique({
      where: { githubId }
    });
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
    return prisma.repository.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });
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
