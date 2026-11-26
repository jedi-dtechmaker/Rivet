import { randomBytes, randomUUID } from 'node:crypto';
import { ccc } from '@ckb-ccc/core';
import { resolveDidCkb } from '@ckb-ccc/did-ckb';
import { Prisma, type VellumBackupClaim } from '@prisma/client';
import type { WriteClaimProps, WriteClaimResult } from '@usevellum/sdk';
import { createTestnetClient } from './ckb-server';
import { prisma } from './db';
import { findVellumBackupEvidence, VellumBackupEvidenceError, type RivetBackupClaimPayload } from './vellum-backup-evidence';
import {
  RIVET_BACKUP_SCHEMA_HASH,
  vellumClaimScripts,
  vellumIssuerConfiguration,
  type VellumIssuerConfiguration,
} from './vellum-config';

const LEASE_KEY = 'repository-backup';
const LEASE_MS = 5 * 60 * 1000;
const ACTIVE_STATUSES = ['preparing', 'prepared', 'submitted'] as const;

type EnabledConfiguration = Extract<VellumIssuerConfiguration, { enabled: true }>;
type ClaimWriter = (props: WriteClaimProps<RivetBackupClaimPayload>) => Promise<WriteClaimResult>;

export type PreparedVellumBackupClaim = {
  claimId: ccc.Hex;
  outputIndex: number;
  signedTransaction: ccc.Hex;
  transactionHash: ccc.Hex;
};

export async function createVellumIssuerSigner(
  client: ccc.Client,
  configuration: EnabledConfiguration,
  dependencies: {
    createSigner?: (client: ccc.Client, privateKey: ccc.Hex) => ccc.SignerCkbPrivateKey;
    resolveDid?: typeof resolveDidCkb;
  } = {},
) {
  const signer = (dependencies.createSigner ?? ((value, privateKey) => new ccc.SignerCkbPrivateKey(value, privateKey)))(client, configuration.issuerPrivateKey);
  const issuer = await (dependencies.resolveDid ?? resolveDidCkb)({ client, did: configuration.issuerDid });
  if (!issuer) throw new Error('The Rivet issuer DID is not active.');
  const addresses = await signer.getAddressObjs();
  if (!addresses.some(({ script }) => script.eq(issuer.cell.cellOutput.lock))) {
    throw new Error('The configured issuer credential does not control the live issuer DID.');
  }
  return signer;
}

export async function prepareVellumBackupClaim(
  claim: Pick<VellumBackupClaim, 'subjectDid' | 'payload' | 'issuedAt' | 'nonce'>,
  client: ccc.Client,
  configuration: EnabledConfiguration,
  dependencies: { createSigner?: typeof createVellumIssuerSigner; writeClaim?: ClaimWriter } = {},
): Promise<PreparedVellumBackupClaim> {
  const signer = await (dependencies.createSigner ?? createVellumIssuerSigner)(client, configuration);
  const write = dependencies.writeClaim ?? (async (props: WriteClaimProps<RivetBackupClaimPayload>) => {
    const { writeClaim } = await import('@usevellum/sdk');
    return writeClaim(props);
  });
  const built = await write({
    issuerSigner: signer,
    scripts: vellumClaimScripts,
    input: {
      subject: { did: claim.subjectDid },
      issuerDid: configuration.issuerDid,
      schemaHash: RIVET_BACKUP_SCHEMA_HASH,
      payload: claim.payload as RivetBackupClaimPayload,
      issuedAt: Math.floor(claim.issuedAt.getTime() / 1_000),
      nonce: claim.nonce,
    },
  });
  const transactionHash = built.tx.hash();
  const signed = await signer.signOnlyTransaction(built.tx);
  if (signed.hash() !== transactionHash) throw new Error('The issuer signer changed the prepared transaction.');
  return { claimId: built.claimId, outputIndex: built.outputIndex,
    signedTransaction: ccc.hexFrom(signed.toBytes()), transactionHash };
}

function jsonPayload(payload: RivetBackupClaimPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

function failureCode(error: unknown) {
  if (error instanceof VellumBackupEvidenceError) return error.code.toUpperCase();
  if (error instanceof Error && /issuer credential|issuer DID/.test(error.message)) return 'ISSUER_CONFIGURATION_INVALID';
  return 'ISSUANCE_UNAVAILABLE';
}

async function queueCandidate(userId: string, repository: string, configuration: EnabledConfiguration, client: ccc.Client) {
  let evidence;
  try { evidence = await findVellumBackupEvidence(userId, repository, configuration.minimumConfirmations, client); }
  catch (error) {
    if (error instanceof VellumBackupEvidenceError && ['not_eligible', 'anchor_pending'].includes(error.code)) return null;
    throw error;
  }
  try {
    return await prisma.vellumBackupClaim.create({ data: {
      repositoryId: evidence.repositoryId,
      userId: evidence.userId,
      subjectDid: evidence.subjectDid,
      issuerDid: configuration.issuerDid,
      schemaHash: RIVET_BACKUP_SCHEMA_HASH,
      nonce: ccc.hexFrom(randomBytes(32)),
      payload: jsonPayload(evidence.payload),
      issuedAt: new Date(evidence.issuedAt * 1_000),
    } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.vellumBackupClaim.findUnique({ where: { repositoryId: evidence.repositoryId } });
    }
    throw error;
  }
}

export async function acquireVellumIssuerLease() {
  return prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824112)`;
    const now = new Date();
    const lease = await transaction.vellumIssuerLease.findUnique({ where: { key: LEASE_KEY } });
    if (lease?.repositoryId && lease.expiresAt > now) return null;
    let claim = lease?.repositoryId ? await transaction.vellumBackupClaim.findUnique({ where: { repositoryId: lease.repositoryId } }) : null;
    if (!claim || !ACTIVE_STATUSES.includes(claim.status as typeof ACTIVE_STATUSES[number])) {
      claim = await transaction.vellumBackupClaim.findFirst({
        where: { status: { in: [...ACTIVE_STATUSES] } }, orderBy: [{ createdAt: 'asc' }, { repositoryId: 'asc' }],
      });
    }
    if (!claim) {
      if (lease) await transaction.vellumIssuerLease.delete({ where: { key: LEASE_KEY } });
      return null;
    }
    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + LEASE_MS);
    await transaction.vellumIssuerLease.upsert({
      where: { key: LEASE_KEY },
      create: { key: LEASE_KEY, token, repositoryId: claim.repositoryId, transactionHash: claim.transactionHash, expiresAt },
      update: { token, repositoryId: claim.repositoryId, transactionHash: claim.transactionHash, expiresAt, revision: { increment: 1 } },
    });
    const updated = await transaction.vellumBackupClaim.update({ where: { repositoryId: claim.repositoryId },
      data: { leaseToken: token, revision: { increment: 1 } } });
    return { claim: updated, token };
  });
}

async function releaseLease(repositoryId: string, token: string) {
  await prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824112)`;
    await transaction.vellumIssuerLease.deleteMany({ where: { key: LEASE_KEY, repositoryId, token } });
    await transaction.vellumBackupClaim.updateMany({ where: { repositoryId, leaseToken: token }, data: { leaseToken: null } });
  });
}

async function markReview(claim: VellumBackupClaim, token: string, code: string) {
  const updated = await prisma.vellumBackupClaim.updateMany({ where: { repositoryId: claim.repositoryId, leaseToken: token },
    data: { status: 'review_required', lastErrorCode: code, leaseToken: null, revision: { increment: 1 } } });
  if (updated.count !== 1) return { status: 'busy' as const };
  await releaseLease(claim.repositoryId, token);
  return { status: 'review_required' as const, repositoryId: claim.repositoryId };
}

async function refreshCandidate(claim: VellumBackupClaim, token: string, configuration: EnabledConfiguration, client: ccc.Client) {
  const repository = await prisma.repository.findUnique({ where: { id: claim.repositoryId }, select: { githubRepoId: true } });
  if (!repository) throw new VellumBackupEvidenceError('anchor_invalid', 'The source repository no longer exists.');
  const evidence = await findVellumBackupEvidence(claim.userId, repository.githubRepoId, configuration.minimumConfirmations, client);
  const updated = await prisma.vellumBackupClaim.updateMany({
    where: { repositoryId: claim.repositoryId, status: 'preparing', leaseToken: token },
    data: { subjectDid: evidence.subjectDid, issuerDid: configuration.issuerDid, schemaHash: RIVET_BACKUP_SCHEMA_HASH,
      payload: jsonPayload(evidence.payload), issuedAt: new Date(evidence.issuedAt * 1_000), lastErrorCode: null, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new Error('The claim candidate changed while it was being prepared.');
  return prisma.vellumBackupClaim.findUniqueOrThrow({ where: { repositoryId: claim.repositoryId } });
}

export function persistedVellumClaimTransaction(claim: Pick<VellumBackupClaim,
  'signedTransaction' | 'transactionHash' | 'claimId' | 'outputIndex'>) {
  if (!claim.signedTransaction || !claim.transactionHash || !claim.claimId || claim.outputIndex === null) {
    throw new Error('The persisted Claim Cell transaction is incomplete.');
  }
  if (claim.signedTransaction.length > 2_000_000) throw new Error('The persisted Claim Cell transaction is too large.');
  const transaction = ccc.Transaction.fromBytes(claim.signedTransaction);
  if (transaction.hash() !== claim.transactionHash || !transaction.outputs[claim.outputIndex]) {
    throw new Error('The persisted Claim Cell transaction does not match its saved reference.');
  }
  return transaction;
}

export async function reconcilePreparedVellumBackupClaim(claim: VellumBackupClaim, token: string, client: ccc.Client) {
  let transaction: ccc.Transaction;
  try { transaction = persistedVellumClaimTransaction(claim); }
  catch { return markReview(claim, token, 'PERSISTED_TRANSACTION_INVALID'); }
  const signedTransaction = claim.signedTransaction!;
  const transactionHash = claim.transactionHash!;
  const outputIndex = claim.outputIndex!;

  const pending = async (code: string) => {
    const updated = await prisma.vellumBackupClaim.updateMany({
      where: { repositoryId: claim.repositoryId, leaseToken: token },
      data: { lastErrorCode: code },
    });
    return updated.count === 1
      ? { status: 'pending' as const, repositoryId: claim.repositoryId }
      : { status: 'busy' as const };
  };
  const reconcileObserved = async (observed: NonNullable<Awaited<ReturnType<ccc.Client['getTransaction']>>>) => {
    if (observed.status === 'rejected') return markReview(claim, token, 'TRANSACTION_REJECTED');
    if (observed.transaction.toHex() !== signedTransaction || !observed.transaction.outputs[outputIndex]) {
      return markReview(claim, token, 'OBSERVED_TRANSACTION_MISMATCH');
    }
    if (observed.status !== 'committed') return null;
    const updated = await prisma.vellumBackupClaim.updateMany({
      where: { repositoryId: claim.repositoryId, leaseToken: token },
      data: { status: 'confirmed', confirmedAt: new Date(), lastErrorCode: null, leaseToken: null, revision: { increment: 1 } },
    });
    if (updated.count !== 1) return { status: 'busy' as const };
    await releaseLease(claim.repositoryId, token);
    return { status: 'confirmed' as const, repositoryId: claim.repositoryId, transactionHash };
  };

  let observed;
  try { observed = await client.getTransaction(transactionHash); }
  catch {
    return pending('RPC_UNAVAILABLE');
  }
  if (observed) {
    const result = await reconcileObserved(observed);
    if (result) return result;
  }
  if (!observed) {
    try {
      const hash = await client.sendTransaction(transaction);
      if (hash !== transactionHash) return markReview(claim, token, 'BROADCAST_HASH_MISMATCH');
    } catch {
      let after;
      try {
        after = await client.getTransaction(transactionHash);
      } catch {
        return pending('BROADCAST_UNCERTAIN');
      }
      if (!after) return pending('BROADCAST_UNCERTAIN');
      const result = await reconcileObserved(after);
      if (result) return result;
    }
  }
  const updated = await prisma.vellumBackupClaim.updateMany({
    where: { repositoryId: claim.repositoryId, leaseToken: token },
    data: { status: 'submitted', lastErrorCode: null, revision: { increment: 1 } },
  });
  return updated.count === 1
    ? { status: 'submitted' as const, repositoryId: claim.repositoryId, transactionHash }
    : { status: 'busy' as const };
}

async function processLease(claim: VellumBackupClaim, token: string, configuration: EnabledConfiguration, client: ccc.Client) {
  let current = claim;
  if (current.status === 'preparing') {
    try { current = await refreshCandidate(current, token, configuration, client); }
    catch (error) {
      if (error instanceof VellumBackupEvidenceError && ['not_eligible', 'anchor_pending', 'service_unavailable', 'subject_changed'].includes(error.code)) {
        await prisma.vellumBackupClaim.updateMany({ where: { repositoryId: current.repositoryId, leaseToken: token }, data: { lastErrorCode: failureCode(error) } });
        return { status: 'pending' as const, repositoryId: current.repositoryId };
      }
      return markReview(current, token, failureCode(error));
    }
    let prepared;
    try { prepared = await prepareVellumBackupClaim(current, client, configuration); }
    catch (error) {
      await prisma.vellumBackupClaim.updateMany({ where: { repositoryId: current.repositoryId, leaseToken: token }, data: { lastErrorCode: failureCode(error) } });
      return { status: 'pending' as const, repositoryId: current.repositoryId };
    }
    const saved = await prisma.vellumBackupClaim.updateMany({
      where: { repositoryId: current.repositoryId, status: 'preparing', leaseToken: token },
      data: { status: 'prepared', claimId: prepared.claimId, outputIndex: prepared.outputIndex,
        signedTransaction: prepared.signedTransaction, transactionHash: prepared.transactionHash,
        lastErrorCode: null, revision: { increment: 1 } },
    });
    if (saved.count !== 1) return { status: 'busy' as const };
    await prisma.vellumIssuerLease.updateMany({ where: { key: LEASE_KEY, repositoryId: current.repositoryId, token },
      data: { transactionHash: prepared.transactionHash, expiresAt: new Date(Date.now() + LEASE_MS), revision: { increment: 1 } } });
    current = await prisma.vellumBackupClaim.findUniqueOrThrow({ where: { repositoryId: current.repositoryId } });
  }
  return reconcilePreparedVellumBackupClaim(current, token, client);
}

export async function runVellumBackupClaimIssuance(input: { userId?: string; repository?: string } = {}) {
  const configuration = vellumIssuerConfiguration();
  if (!configuration.enabled) return { status: 'disabled' as const };
  const client = createTestnetClient();
  if (input.userId && input.repository) await queueCandidate(input.userId, input.repository, configuration, client);
  if (input.userId && !input.repository) {
    const repositories = await prisma.repository.findMany({ where: { userId: input.userId, isPrivate: false, isBackedUp: true, vellumClaim: null },
      select: { githubRepoId: true }, orderBy: { updatedAt: 'asc' }, take: 20 });
    for (const repository of repositories) {
      try { await queueCandidate(input.userId, repository.githubRepoId, configuration, client); }
      catch (error) {
        if (!(error instanceof VellumBackupEvidenceError) || !['not_eligible', 'anchor_pending', 'service_unavailable', 'subject_changed'].includes(error.code)) throw error;
      }
    }
  }
  const leased = await acquireVellumIssuerLease();
  if (!leased) return { status: 'busy' as const };
  return processLease(leased.claim, leased.token, configuration, client);
}
