import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, readWithConnectionRetry } from './db';
import { vellumPublicUrls } from './vellum-config';
import {
  resolveVellumController,
  vellumDisplayName,
  verifyVellumControllerSignature,
  type VellumControllerSignature,
} from './vellum-controller';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SIGN_TYPES = new Set(['BtcEcdsa', 'EvmPersonal', 'JoyId', 'NostrEvent', 'CkbSecp256k1', 'DogeEcdsa']);

export type VellumIdentityDependencies = {
  now: () => Date;
  nonce: () => string;
  resolveController: typeof resolveVellumController;
  verifySignature: typeof verifyVellumControllerSignature;
};

const defaultDependencies: VellumIdentityDependencies = {
  now: () => new Date(),
  nonce: randomUUID,
  resolveController: resolveVellumController,
  verifySignature: verifyVellumControllerSignature,
};

function proof(value: unknown): VellumControllerSignature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A wallet signature is required.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.identity !== 'string' || candidate.identity.length < 1 || candidate.identity.length > 16_384
    || typeof candidate.signature !== 'string' || candidate.signature.length < 1 || candidate.signature.length > 16_384
    || typeof candidate.signType !== 'string' || !SIGN_TYPES.has(candidate.signType)) {
    throw new TypeError('The wallet signature is invalid.');
  }
  return candidate as VellumControllerSignature;
}

function challengeMessage(input: {
  account: string;
  controllerLockHash: string;
  did: string;
  expiresAt: Date;
  nonce: string;
  origin: string;
}) {
  return [
    'Rivet Vellum identity linking',
    `Origin: ${input.origin}`,
    `Account: ${input.account}`,
    `Identity: ${input.did}`,
    `Controller: ${input.controllerLockHash}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

export async function createVellumIdentityChallenge(
  userId: string,
  did: string,
  origin: string,
  dependencies: VellumIdentityDependencies = defaultDependencies,
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { githubId: true } });
  if (!user) throw new Error('Account not found.');
  const controller = await dependencies.resolveController(did);
  const id = dependencies.nonce();
  const now = dependencies.now();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const controllerLockHash = controller.lock.hash();
  const message = challengeMessage({ account: user.githubId, controllerLockHash, did: controller.did, expiresAt, nonce: id, origin });
  await prisma.vellumDidChallenge.upsert({
    where: { userId },
    create: { id, userId, did: controller.did, controllerLockHash, message, expiresAt },
    update: { id, did: controller.did, controllerLockHash, message, expiresAt, createdAt: now },
  });
  return { challengeId: id, did: controller.did, expiresAt, message };
}

export async function completeVellumIdentityChallenge(input: {
  userId: string;
  challengeId: unknown;
  signature: unknown;
  isPublic: unknown;
}, dependencies: VellumIdentityDependencies = defaultDependencies) {
  if (typeof input.challengeId !== 'string' || input.challengeId.length > 100) throw new TypeError('A valid identity challenge is required.');
  if (typeof input.isPublic !== 'boolean') throw new TypeError('Choose whether to share this identity publicly.');
  const isPublic = input.isPublic;
  const walletSignature = proof(input.signature);
  const challenge = await prisma.vellumDidChallenge.findUnique({ where: { userId: input.userId } });
  const now = dependencies.now();
  if (!challenge || challenge.id !== input.challengeId || challenge.expiresAt <= now) {
    throw new TypeError('Identity verification expired. Start again.');
  }
  const controller = await dependencies.resolveController(challenge.did);
  if (controller.lock.hash() !== challenge.controllerLockHash) {
    throw new TypeError('The identity controller changed. Start verification again.');
  }
  if (!(await dependencies.verifySignature(challenge.message, controller, walletSignature))) {
    throw new TypeError('The connected wallet does not control this identity.');
  }

  return prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824111)`;
    const current = await transaction.vellumDidChallenge.findUnique({ where: { userId: input.userId } });
    const consumedAt = dependencies.now();
    if (!current || current.id !== challenge.id || current.expiresAt <= consumedAt
      || current.did !== challenge.did || current.controllerLockHash !== challenge.controllerLockHash
      || current.message !== challenge.message) throw new TypeError('Identity verification expired. Start again.');
    const consumed = await transaction.vellumDidChallenge.deleteMany({ where: { id: challenge.id, userId: input.userId, expiresAt: { gt: consumedAt } } });
    if (consumed.count !== 1) throw new TypeError('Identity verification expired. Start again.');
    return transaction.vellumIdentityBinding.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, did: controller.did, controllerLockHash: challenge.controllerLockHash, isPublic },
      update: { did: controller.did, controllerLockHash: challenge.controllerLockHash, isPublic, verifiedAt: consumedAt },
    });
  });
}

export async function updateVellumIdentityVisibility(userId: string, isPublic: unknown) {
  if (typeof isPublic !== 'boolean') throw new TypeError('Choose whether to share this identity publicly.');
  return prisma.vellumIdentityBinding.update({ where: { userId }, data: { isPublic } });
}

export async function unlinkVellumIdentity(userId: string) {
  return prisma.$transaction(async transaction => {
    await transaction.vellumDidChallenge.deleteMany({ where: { userId } });
    return transaction.vellumIdentityBinding.deleteMany({ where: { userId } });
  });
}

type ReputationSummary = {
  policyVersion: string;
  evaluatedAt: number;
  overall: { score: number; maximum: number };
  categories: { id: string; score: number; maximum: number }[];
  evidenceCount: number;
};

function safeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

export async function fetchVellumReputation(did: string, fetchImplementation: typeof fetch = fetch): Promise<ReputationSummary | null> {
  const { api } = vellumPublicUrls();
  let response: Response;
  try {
    response = await fetchImplementation(`${api}/api/reputation/${encodeURIComponent(did)}`, {
      cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
    });
  } catch { return null; }
  if (!response.ok) return null;
  let value: unknown;
  try { value = await response.json(); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const overall = body.overall as Record<string, unknown> | undefined;
  const categories = body.categories;
  if (body.ok !== true || body.status !== 'available' || body.subject !== did || typeof body.policyVersion !== 'string'
    || !safeInteger(body.evaluatedAt) || !overall || !safeInteger(overall.score, 1_000) || overall.maximum !== 1_000
    || !Array.isArray(categories) || categories.length > 20 || !Array.isArray(body.evidence)) return null;
  const parsedCategories: ReputationSummary['categories'] = [];
  for (const category of categories) {
    if (!category || typeof category !== 'object' || Array.isArray(category)) return null;
    const item = category as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.length > 80 || !safeInteger(item.score, 1_000)
      || !safeInteger(item.maximum, 1_000) || item.maximum < 1 || item.score > item.maximum) return null;
    parsedCategories.push({ id: item.id, score: item.score, maximum: item.maximum });
  }
  return { policyVersion: body.policyVersion, evaluatedAt: body.evaluatedAt, overall: { score: overall.score, maximum: 1_000 },
    categories: parsedCategories, evidenceCount: body.evidence.length };
}

async function resolveBinding(binding: { did: string; controllerLockHash: string }) {
  try {
    const controller = await resolveVellumController(binding.did);
    return {
      status: controller.lock.hash() === binding.controllerLockHash ? 'verified' as const : 'controller_changed' as const,
      displayName: vellumDisplayName(controller.document),
    };
  } catch { return { status: 'unavailable' as const, displayName: null }; }
}

export async function getVellumIdentityState(userId: string) {
  const [binding, claims] = await Promise.all([
    readWithConnectionRetry(() => prisma.vellumIdentityBinding.findUnique({ where: { userId } })),
    readWithConnectionRetry(() => prisma.vellumBackupClaim.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: {
      repositoryId: true, subjectDid: true, status: true, claimId: true, transactionHash: true, outputIndex: true, lastErrorCode: true,
      repository: { select: { fullName: true } },
    } })),
  ]);
  if (!binding) return { binding: null, claims: [], profileUrl: null };
  const resolved = await resolveBinding(binding);
  const { profile } = vellumPublicUrls();
  return {
    binding: { did: binding.did, isPublic: binding.isPublic, verifiedAt: binding.verifiedAt, ...resolved },
    profileUrl: `${profile}/profile/${encodeURIComponent(binding.did)}`,
    claims: claims.map(claim => ({ ...claim, explorerUrl: claim.transactionHash
      ? `https://pudge.explorer.nervos.org/transaction/${claim.transactionHash}` : null })),
  };
}

export async function getPublicVellumIdentity(username: string) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) return null;
  const user = await readWithConnectionRetry(() => prisma.user.findFirst({
    where: { githubUsername: username, isProfilePublic: true, vellumIdentity: { is: { isPublic: true } } },
    select: { vellumIdentity: true },
  }));
  const binding = user?.vellumIdentity;
  if (!binding) return null;
  const resolved = await resolveBinding(binding);
  const { profile } = vellumPublicUrls();
  const reputation = resolved.status === 'verified' ? await fetchVellumReputation(binding.did) : null;
  return {
    did: binding.did,
    displayName: resolved.displayName,
    status: resolved.status,
    verifiedAt: binding.verifiedAt,
    reputation,
    profileUrl: `${profile}/profile/${encodeURIComponent(binding.did)}`,
  };
}

export function vellumIdentityConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
