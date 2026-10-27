import { createHash, randomUUID } from 'node:crypto';
import { ccc } from '@ckb-ccc/core';
import { Prisma, PrismaClient, CotaManifestOperation, CotaManifestSignedAttempt } from '@prisma/client';

type Json = Prisma.InputJsonValue;
type Database = Prisma.TransactionClient;
export type PreflightOutcome = 'passed' | 'invalid' | 'unsupported' | 'unavailable';
export type ManifestReservationInput = {
  network: string;
  cotaScriptHash: string;
  userId?: string | null;
  kind: string;
  protocol?: string;
  sourceOutpoint: string;
  snapshot: Json;
  leaseMs?: number;
};
export type ManifestPlanInput = {
  unsignedTransaction: Json;
  serializedUnsignedTransaction: string;
  txHash: string;
  root?: string;
  previousRoot?: string;
  plan?: Json;
  // This callback is for short database-only revision checks. Never perform
  // blockchain, wallet, indexer or other network requests inside it.
  assertSnapshot?: (database: Database, operation: CotaManifestOperation) => Promise<void>;
};
export type SignedManifestCandidate = {
  signedTransaction: Json;
  serializedTransaction: string;
  txHash: string;
};

export class PublicationConflictError extends Error {
  constructor(message = 'The CoTA publication reservation changed. Reload its current state.') {
    super(message);
    this.name = 'PublicationConflictError';
  }
}

function normalizedBytes(value: string) {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('A complete serialized transaction is required.');
  if (value.length > 2_000_002) throw new Error('The serialized transaction exceeds the publication limit.');
  return value.toLowerCase();
}

// Raw transaction hashes exclude witnesses. This digest identifies the entire
// signature candidate, including all witnesses, and must never be substituted
// with transaction.hash().
export function manifestAttemptDigest(serializedTransaction: string) {
  return `0x${createHash('sha256').update(Buffer.from(normalizedBytes(serializedTransaction).slice(2), 'hex')).digest('hex')}`;
}

function validatedTransaction(transaction: Json, serialized: string, txHash: string) {
  const bytes = normalizedBytes(serialized);
  const parsed = ccc.Transaction.from(transaction as unknown as ccc.TransactionLike);
  if (ccc.hexFrom(parsed.toBytes()).toLowerCase() !== bytes || parsed.hash() !== txHash.toLowerCase()) {
    throw new Error('The transaction JSON, hash and serialized bytes do not agree.');
  }
  return { bytes, digest: manifestAttemptDigest(bytes) };
}

async function lockStream(database: Database, streamId: string) {
  // Only the actual publication cell's row is locked, never a global lock.
  await database.$queryRaw`SELECT "id" FROM "PublicationStream" WHERE "id" = ${streamId} FOR UPDATE`;
  const stream = await database.publicationStream.findUnique({ where: { id: streamId } });
  if (!stream) throw new PublicationConflictError();
  return stream;
}

async function ensureStream(database: Database, input: { network: string; cotaScriptHash: string; sourceOutpoint: string }) {
  const identity = { network: input.network, cotaScriptHash: input.cotaScriptHash.toLowerCase() };
  // Prisma 5 emulates an empty-update upsert with SELECT + INSERT, which
  // races on a stream's first reservation. Let PostgreSQL arbitrate it.
  const streamId = randomUUID();
  const now = new Date();
  await database.$executeRaw`INSERT INTO "PublicationStream" ("id", "network", "cotaScriptHash", "headOutpoint", "createdAt", "updatedAt") VALUES (${streamId}, ${identity.network}, ${identity.cotaScriptHash}, ${input.sourceOutpoint}, ${now}, ${now}) ON CONFLICT ("network", "cotaScriptHash") DO NOTHING`;
  const stream = (await database.publicationStream.findUnique({ where: { network_cotaScriptHash: identity } }))!;
  return lockStream(database, stream.id);
}

async function reservedOperation(database: Database, operationId: string) {
  const initial = await database.cotaManifestOperation.findUnique({ where: { id: operationId } });
  if (!initial) throw new Error('CoTA manifest operation not found.');
  const stream = await lockStream(database, initial.streamId);
  const operation = (await database.cotaManifestOperation.findUnique({ where: { id: operationId } }))!;
  if (stream.reservationId !== operation.id || stream.revision !== operation.revision) throw new PublicationConflictError();
  return { operation, stream };
}

function diagnosticsWith(previous: Prisma.JsonValue | null, field: string, value?: Json) {
  const object = previous && !Array.isArray(previous) && typeof previous === 'object' ? previous : {};
  return { ...object, [field]: value ?? {} } as Json;
}

/** Persistent transitions only. All RPC/proof generation belongs between calls. */
export function createManifestStateStore(client: PrismaClient) {
  const transaction = <Result>(work: (database: Database) => Promise<Result>) =>
    client.$transaction(work, { maxWait: 5000, timeout: 10000 });

  return {
    // The caller must first resolve and verify the committed singleton's owner,
    // type and current outpoint outside this database transaction. An externally
    // changed head never authorizes replacing a pending or uncertain plan.
    async reconcileHead(input: { network: string; cotaScriptHash: string; sourceOutpoint: string }) {
      if (!input.network || !input.sourceOutpoint || !/^0x[0-9a-f]{64}$/i.test(input.cotaScriptHash)) throw new Error('The verified CoTA stream identity and source are required.');
      return transaction(async database => {
        const stream = await ensureStream(database, input);
        if (stream.headOutpoint === input.sourceOutpoint) return stream;
        if (stream.reservationId) throw new PublicationConflictError('A pending CoTA publication needs explicit reconciliation before its input can be replaced.');
        return database.publicationStream.update({ where: { id: stream.id }, data: {
          headOutpoint: input.sourceOutpoint, revision: { increment: 1 },
        } });
      });
    },

    async reserve(input: ManifestReservationInput) {
      if (!/^0x[0-9a-f]{64}$/i.test(input.cotaScriptHash)) throw new Error('The actual CoTA type-script hash is required.');
      if (!input.network || !input.kind || !input.sourceOutpoint) throw new Error('The publication identity and source are required.');
      const leaseMs = input.leaseMs ?? 120000;
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 600000) throw new Error('The build lease is invalid.');
      return transaction(async database => {
        const stream = await ensureStream(database, input);
        if (stream.reservationId) {
          const pending = await database.cotaManifestOperation.findUnique({ where: { id: stream.reservationId } });
          if (!pending) throw new PublicationConflictError('The publication reservation requires reconciliation.');
          // Expiry is permission to restart only an unpublished build. A signed,
          // submitted or unknown transaction can never be replaced by a timer.
          if (pending.status !== 'building' || pending.acceptedAttemptId || !stream.reservedUntil || stream.reservedUntil > new Date()) {
            return { operation: pending, stream, existing: true };
          }
          await database.cotaManifestOperation.update({ where: { id: pending.id }, data: { status: 'abandoned' } });
        }
        if (stream.headOutpoint && stream.headOutpoint !== input.sourceOutpoint) {
          throw new PublicationConflictError('The CoTA source differs from the saved head. Reconcile the confirmed successor first.');
        }
        const id = randomUUID();
        const revision = stream.revision + 1;
        const operation = await database.cotaManifestOperation.create({ data: {
          id, userId: input.userId ?? null, streamId: stream.id, protocol: input.protocol ?? 'cota-manifest-v1',
          kind: input.kind, sourceOutpoint: input.sourceOutpoint, revision, snapshot: input.snapshot, status: 'building',
        } });
        const reserved = await database.publicationStream.update({ where: { id: stream.id }, data: {
          revision, reservationId: id, reservedUntil: new Date(Date.now() + leaseMs), headOutpoint: input.sourceOutpoint,
        } });
        return { operation, stream: reserved, existing: false };
      });
    },

    async commitPlan(operationId: string, input: ManifestPlanInput) {
      const { bytes, digest } = validatedTransaction(input.unsignedTransaction, input.serializedUnsignedTransaction, input.txHash);
      return transaction(async database => {
        const { operation, stream } = await reservedOperation(database, operationId);
        if (operation.planDigest) {
          if (operation.planDigest !== digest) throw new PublicationConflictError('The unsigned publication plan is immutable.');
          return operation;
        }
        if (operation.status !== 'building' || !stream.reservedUntil || stream.reservedUntil <= new Date()) throw new PublicationConflictError();
        await input.assertSnapshot?.(database, operation);
        return database.cotaManifestOperation.update({ where: { id: operationId }, data: {
          unsignedTransaction: input.unsignedTransaction, serializedUnsignedTransaction: bytes, planDigest: digest,
          txHash: input.txHash.toLowerCase(), root: input.root, previousRoot: input.previousRoot, plan: input.plan,
          status: 'awaiting_signature',
        } });
      });
    },

    async abandonBuild(operationId: string, diagnostics?: Json) {
      return transaction(async database => {
        const { operation, stream } = await reservedOperation(database, operationId);
        if (operation.status !== 'building' || operation.acceptedAttemptId) throw new PublicationConflictError('Only an unpublished build may be abandoned.');
        const result = await database.cotaManifestOperation.update({ where: { id: operationId }, data: { status: 'abandoned', diagnostics } });
        await database.publicationStream.update({ where: { id: stream.id }, data: { reservationId: null, reservedUntil: null, revision: { increment: 1 } } });
        return result;
      });
    },

    async recordSignedAttempt(operationId: string, input: SignedManifestCandidate) {
      const { bytes, digest } = validatedTransaction(input.signedTransaction, input.serializedTransaction, input.txHash);
      return transaction(async database => {
        const { operation } = await reservedOperation(database, operationId);
        const previous = await database.cotaManifestSignedAttempt.findUnique({ where: { operationId_digest: { operationId, digest } } });
        if (previous) return previous;
        if (operation.acceptedAttemptId || !['awaiting_signature', 'validating'].includes(operation.status)) {
          throw new PublicationConflictError('An accepted signature attempt cannot be replaced.');
        }
        if (operation.txHash !== input.txHash.toLowerCase()) throw new Error('The signed candidate changes the unsigned transaction.');
        const attempt = await database.cotaManifestSignedAttempt.create({ data: {
          operationId, digest, signedTransaction: input.signedTransaction, serializedTransaction: bytes, txHash: input.txHash.toLowerCase(),
        } });
        await database.cotaManifestOperation.update({ where: { id: operationId }, data: { status: 'validating' } });
        return attempt;
      });
    },

    async finishPreflight(attemptId: string, outcome: PreflightOutcome, diagnostics?: Json) {
      return transaction(async database => {
        const initial = await database.cotaManifestSignedAttempt.findUnique({ where: { id: attemptId } });
        if (!initial) throw new Error('CoTA signature attempt not found.');
        const { operation } = await reservedOperation(database, initial.operationId);
        const attempt = (await database.cotaManifestSignedAttempt.findUnique({ where: { id: attemptId } }))!;
        if (!['pending', 'unavailable'].includes(attempt.preflight)) {
          if (attempt.preflight !== outcome) throw new PublicationConflictError('A definitive preflight result cannot be rewritten.');
          return attempt;
        }
        if (attempt.firstBroadcastAt || operation.acceptedAttemptId) throw new PublicationConflictError();
        const result = await database.cotaManifestSignedAttempt.update({ where: { id: attemptId }, data: {
          preflight: outcome, status: outcome === 'passed' ? 'ready' : outcome,
          diagnostics: diagnosticsWith(attempt.diagnostics, 'preflight', diagnostics),
        } });
        await database.cotaManifestOperation.update({ where: { id: operation.id }, data: {
          status: outcome === 'unsupported' ? 'blocked' : 'awaiting_signature',
          ...(outcome === 'unsupported' ? { diagnostics: diagnosticsWith(operation.diagnostics, 'unsupported', diagnostics) } : {}),
        } });
        return result;
      });
    },

    async acceptAttempt(operationId: string, attemptId: string) {
      return transaction(async database => {
        const { operation } = await reservedOperation(database, operationId);
        if (operation.acceptedAttemptId) {
          if (operation.acceptedAttemptId !== attemptId) throw new PublicationConflictError('An accepted signature attempt cannot be replaced.');
          return operation;
        }
        const attempt = await database.cotaManifestSignedAttempt.findFirst({ where: { id: attemptId, operationId } });
        if (!attempt || attempt.preflight !== 'passed' || attempt.status !== 'ready') throw new Error('The signature candidate must pass preflight before acceptance.');
        return database.cotaManifestOperation.update({ where: { id: operationId }, data: { acceptedAttemptId: attemptId, status: 'signed_ready' } });
      });
    },

    async beginBroadcast(operationId: string) {
      return transaction(async database => {
        const { operation } = await reservedOperation(database, operationId);
        if (!operation.acceptedAttemptId || !['signed_ready', 'broadcasting', 'unknown', 'submitted'].includes(operation.status)) {
          throw new Error('There is no accepted signature ready to broadcast.');
        }
        const attempt = await database.cotaManifestSignedAttempt.findUnique({ where: { id: operation.acceptedAttemptId } });
        if (!attempt || attempt.operationId !== operationId || attempt.preflight !== 'passed') throw new PublicationConflictError();
        // Return only the persisted bytes. A crash after this commit must retry
        // this same candidate, even when the node reports no transaction yet.
        validatedTransaction(attempt.signedTransaction as Json, attempt.serializedTransaction, attempt.txHash);
        const now = new Date();
        const persistedAttempt = await database.cotaManifestSignedAttempt.update({ where: { id: attempt.id }, data: {
          status: 'broadcasting', firstBroadcastAt: attempt.firstBroadcastAt ?? now, lastBroadcastAt: now,
        } });
        const persistedOperation = await database.cotaManifestOperation.update({ where: { id: operationId }, data: { status: 'broadcasting' } });
        return { operation: persistedOperation, attempt: persistedAttempt };
      });
    },

    async markBroadcast(attemptId: string, outcome: 'submitted' | 'unknown', diagnostics?: Json) {
      return transaction(async database => {
        const attempt = await database.cotaManifestSignedAttempt.findUnique({ where: { id: attemptId } });
        if (!attempt) throw new Error('CoTA signature attempt not found.');
        const { operation } = await reservedOperation(database, attempt.operationId);
        if (operation.acceptedAttemptId !== attemptId || !attempt.firstBroadcastAt) throw new PublicationConflictError();
        await database.cotaManifestSignedAttempt.update({ where: { id: attemptId }, data: {
          status: outcome, diagnostics: diagnosticsWith(attempt.diagnostics, 'broadcast', diagnostics),
        } });
        return database.cotaManifestOperation.update({ where: { id: operation.id }, data: { status: outcome } });
      });
    },

    async block(operationId: string, diagnostics?: Json) {
      return transaction(async database => {
        const { operation } = await reservedOperation(database, operationId);
        if (operation.acceptedAttemptId) {
          const attempt = await database.cotaManifestSignedAttempt.findUnique({ where: { id: operation.acceptedAttemptId } });
          if (!attempt) throw new PublicationConflictError();
          await database.cotaManifestSignedAttempt.update({ where: { id: attempt.id }, data: {
            status: 'blocked', diagnostics: diagnosticsWith(attempt.diagnostics, 'reconciliation', diagnostics),
          } });
        }
        return database.cotaManifestOperation.update({ where: { id: operationId }, data: {
          status: 'blocked', diagnostics: diagnosticsWith(operation.diagnostics, 'reconciliation', diagnostics),
        } });
      });
    },

    async confirm(operationId: string, input: { transaction: Json; successorOutpoint: string; observedCommitted?: boolean }) {
      const actual = ccc.Transaction.from(input.transaction as unknown as ccc.TransactionLike);
      return transaction(async database => {
        const initial = await database.cotaManifestOperation.findUnique({ where: { id: operationId } });
        if (!initial) throw new Error('CoTA manifest operation not found.');
        const stream = await lockStream(database, initial.streamId);
        const operation = (await database.cotaManifestOperation.findUnique({ where: { id: operationId } }))!;
        if (operation.status === 'confirmed') return operation;
        if (stream.reservationId !== operation.id || stream.revision !== operation.revision) throw new PublicationConflictError();
        if (!operation.acceptedAttemptId || actual.hash() !== operation.txHash || !input.successorOutpoint.startsWith(`${actual.hash()}:`)) {
          throw new Error('The committed transaction does not match the accepted publication.');
        }
        const accepted = await database.cotaManifestSignedAttempt.findUnique({ where: { id: operation.acceptedAttemptId } });
        if (!accepted || accepted.preflight !== 'passed' || (!accepted.firstBroadcastAt && !input.observedCommitted)) {
          throw new PublicationConflictError('The accepted publication has not started broadcasting.');
        }
        // Callers must first validate the actual confirmed witnesses and its
        // protocol bindings. They may differ from a locally saved signature.
        const confirmed = await database.cotaManifestOperation.update({ where: { id: operationId }, data: {
          status: 'confirmed', confirmedTransaction: input.transaction,
        } });
        await database.cotaManifestSignedAttempt.update({ where: { id: accepted.id }, data: { status: 'confirmed' } });
        await database.publicationStream.update({ where: { id: stream.id }, data: {
          headOutpoint: input.successorOutpoint, reservationId: null, reservedUntil: null, revision: { increment: 1 },
        } });
        return confirmed;
      });
    },
  };
}

export type ManifestStateStore = ReturnType<typeof createManifestStateStore>;
export type { CotaManifestOperation, CotaManifestSignedAttempt };
