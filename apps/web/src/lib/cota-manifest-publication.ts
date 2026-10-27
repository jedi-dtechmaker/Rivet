import { ccc } from '@ckb-ccc/core';
import { Prisma, PrismaClient, CotaManifestOperation } from '@prisma/client';
import { prisma } from './db';
import { createTestnetClient } from './ckb-server';
import { createManifestStateStore, PublicationConflictError } from './cota-manifest-state';

type Diagnostics = Record<string, string | number | boolean>;
export class ManifestPublicationError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string,
    public readonly diagnostics: Diagnostics = {}) {
    super(message);
    this.name = 'ManifestPublicationError';
  }
}

export type ManifestPublicationOptions = {
  signedTransaction?: ccc.TransactionLike;
  signer?: Pick<ccc.Signer, 'signTransaction'>;
  client?: Pick<ccc.Client, 'getTransaction' | 'sendTransactionDry' | 'sendTransaction'>;
  database?: PrismaClient;
  successorOutputIndex?: number;
  validateSigned: (unsigned: ccc.Transaction, signed: ccc.Transaction, operation: CotaManifestOperation) => void | Promise<void>;
};

const JOYID_TYPE_HASH = '0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac';
const SERVICE_KINDS = new Set(['issue', 'define', 'register', 'issuer-define', 'issuer-register']);
const jsonTransaction = (transaction: ccc.Transaction) => JSON.parse(transaction.stringify()) as Prisma.InputJsonValue;
const signatureInvalid = (diagnostics?: Diagnostics) => new ManifestPublicationError('MANIFEST_SIGNATURE_INVALID', 422,
  'The signature candidate is invalid. The unsigned manifest plan is preserved; approve it again in the correct wallet.', diagnostics);
const planUnsupported = (diagnostics?: Diagnostics) => new ManifestPublicationError('MANIFEST_PLAN_UNSUPPORTED', 422,
  'The prepared CoTA operation is unsupported by the deployed scripts. The plan is blocked for review; another signature cannot repair it.', diagnostics);
const reconciliationRequired = (diagnostics?: Diagnostics) => new ManifestPublicationError('MANIFEST_RECONCILIATION_REQUIRED', 409,
  'The saved CoTA operation needs reconciliation. Its history and reservation are preserved.', diagnostics);
const unavailable = (code = 'MANIFEST_PREFLIGHT_UNAVAILABLE', diagnostics?: Diagnostics) => new ManifestPublicationError(code, 503,
  'The CoTA service could not complete this request. Your saved plan and signature candidates are preserved. Retry shortly.', diagnostics);

// Extract structured diagnostic fields only. RPC error messages/data can carry
// full signed transactions, URLs or credentials and must never be persisted or
// returned verbatim.
export function manifestPreflightFailure(error: unknown) {
  const fields = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const diagnostics: Diagnostics = {};
  if (typeof fields.code === 'number' || (typeof fields.code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(fields.code))) diagnostics.rpcCode = fields.code;
  const raw = typeof fields.data === 'string' ? fields.data : '';
  const parsed = raw.match(/source: (Inputs|Outputs)\[(\d+)\]\.(Lock|Type), cause: ValidationFailure: see error code (-?\d+) on page https:\/\/nervosnetwork\.github\.io\/ckb-script-error-codes\/by-(type|data)-hash\/([a-f0-9]{64})\.html/);
  if (parsed) {
    const [, location, index, kind, scriptCode, hashType, hash] = parsed;
    Object.assign(diagnostics, { source: kind === 'Lock' ? 'lock' : location === 'Inputs' ? 'inputType' : 'outputType',
      sourceIndex: Number(index), scriptCode: Number(scriptCode), scriptHashType: hashType, scriptCodeHash: `0x${hash}` });
  } else if (['lock', 'inputType', 'outputType'].includes(String(fields.source)) && typeof fields.errorCode === 'number') {
    diagnostics.source = String(fields.source);
    diagnostics.scriptCode = fields.errorCode;
    if (typeof fields.sourceIndex === 'bigint' || typeof fields.sourceIndex === 'number') diagnostics.sourceIndex = String(fields.sourceIndex);
    if (typeof fields.scriptCodeHash === 'string' && /^0x[0-9a-f]{64}$/i.test(fields.scriptCodeHash)) diagnostics.scriptCodeHash = fields.scriptCodeHash.toLowerCase();
  }
  const validationFailure = fields.code === -302 || fields instanceof ccc.ErrorClientVerification;
  if (validationFailure) {
    const unsupported = diagnostics.source !== 'lock'
      || (diagnostics.scriptCodeHash === JOYID_TYPE_HASH && diagnostics.scriptCode === 16);
    return { outcome: unsupported ? 'unsupported' as const : 'invalid' as const, diagnostics };
  }
  let cause: unknown = fields.cause;
  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    const nested = cause as Record<string, unknown>;
    if (typeof nested.code === 'string' && /^(E[A-Z0-9_]{1,30}|UND_ERR_[A-Z_]{1,30})$/.test(nested.code)) diagnostics.causeCode = nested.code;
    cause = nested.cause;
  }
  return { outcome: 'unavailable' as const, diagnostics };
}

function unsignedTransaction(operation: CotaManifestOperation) {
  if (!operation.unsignedTransaction || !operation.txHash) throw new ManifestPublicationError('MANIFEST_PLAN_NOT_READY', 409, 'The CoTA publication plan is still being prepared.');
  return ccc.Transaction.from(operation.unsignedTransaction as unknown as ccc.TransactionLike);
}

// A signature can change witness locks, but cannot alter the raw transaction or
// any prepared proof/binding witness. Protocol-specific policy remains required
// through validateSigned for both submitted candidates and committed witnesses.
async function validateCandidate(operation: CotaManifestOperation, signed: ccc.Transaction, options: ManifestPublicationOptions) {
  const unsigned = unsignedTransaction(operation);
  if (unsigned.hash() !== signed.hash() || signed.toBytes().length > 1_000_000 || signed.witnesses.length < unsigned.witnesses.length) throw signatureInvalid();
  for (let index = 0; index < unsigned.witnesses.length; index++) {
    if (unsigned.witnesses[index] === '0x') continue;
    let expected: ReturnType<ccc.Transaction['getWitnessArgs']>;
    try { expected = unsigned.getWitnessArgs(index); }
    catch {
      if (signed.witnesses[index] !== unsigned.witnesses[index]) throw signatureInvalid();
      continue;
    }
    let actual: ReturnType<ccc.Transaction['getWitnessArgs']>;
    try { actual = signed.getWitnessArgs(index); } catch { throw signatureInvalid(); }
    if (expected?.inputType !== actual?.inputType || expected?.outputType !== actual?.outputType) throw signatureInvalid();
  }
  await options.validateSigned(unsigned, signed, operation);
}

function blockedError(operation: CotaManifestOperation) {
  const diagnostics = operation.diagnostics && typeof operation.diagnostics === 'object' && !Array.isArray(operation.diagnostics)
    ? operation.diagnostics : {};
  return diagnostics.unsupported ? planUnsupported() : reconciliationRequired();
}

async function completedAfterConflict(database: PrismaClient, operationId: string, error: unknown) {
  if (!(error instanceof PublicationConflictError)) throw error;
  const current = await database.cotaManifestOperation.findUnique({ where: { id: operationId } });
  if (current?.status === 'confirmed' || current?.status === 'submitted') return current;
  if (current?.status === 'blocked') throw blockedError(current);
  throw reconciliationRequired();
}

async function markBroadcast(database: PrismaClient, operationId: string, attemptId: string,
  outcome: 'submitted' | 'unknown', diagnostics?: Prisma.InputJsonValue) {
  try { return await createManifestStateStore(database).markBroadcast(attemptId, outcome, diagnostics); }
  catch (error) { return completedAfterConflict(database, operationId, error); }
}

/** Reconcile with the actual node response; never infer an unspent input from a missing hash. */
export async function refreshManifestOperation(saved: CotaManifestOperation, options: ManifestPublicationOptions) {
  const database = options.database ?? prisma;
  const state = createManifestStateStore(database);
  const operation = await database.cotaManifestOperation.findUnique({ where: { id: saved.id } });
  if (!operation) throw new ManifestPublicationError('MANIFEST_NOT_FOUND', 404, 'The CoTA publication was not found.');
  if (operation.status === 'confirmed' || operation.status === 'blocked' || !operation.acceptedAttemptId || !operation.txHash) return operation;
  const client = options.client ?? createTestnetClient();
  let observed;
  try { observed = await client.getTransaction(operation.txHash); }
  catch (error) { throw unavailable('MANIFEST_RECONCILIATION_UNAVAILABLE', manifestPreflightFailure(error).diagnostics); }
  const attempt = await database.cotaManifestSignedAttempt.findUnique({ where: { id: operation.acceptedAttemptId } });
  if (!attempt || attempt.operationId !== operation.id || attempt.preflight !== 'passed') throw reconciliationRequired();
  if (observed?.status === 'committed') {
    try { await validateCandidate(operation, observed.transaction, options); }
    catch {
      await state.block(operation.id, { code: 'MANIFEST_COMMITTED_BINDING_MISMATCH' });
      throw new ManifestPublicationError('MANIFEST_COMMITTED_BINDING_MISMATCH', 409,
        'The committed witnesses differ from the approved manifest binding. The operation is blocked for reconciliation.');
    }
    const outputIndex = options.successorOutputIndex ?? 0;
    if (!Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex >= observed.transaction.outputs.length) throw reconciliationRequired();
    return state.confirm(operation.id, { transaction: jsonTransaction(observed.transaction),
      successorOutpoint: `${observed.transaction.hash()}:${outputIndex}`, observedCommitted: true });
  }
  if (observed?.status === 'rejected') {
    await state.block(operation.id, { code: 'MANIFEST_NODE_REJECTED' });
    throw reconciliationRequired({ reason: 'node_rejected' });
  }
  if (observed?.status === 'pending' || observed?.status === 'proposed') {
    // An accepted candidate may have been broadcast manually. Record that the
    // node has it without sending another transaction.
    if (!attempt.firstBroadcastAt) {
      try { await state.beginBroadcast(operation.id); }
      catch (error) { return completedAfterConflict(database, operation.id, error); }
    }
    return markBroadcast(database, operation.id, attempt.id, 'submitted', { source: 'node_observation' });
  }
  if (attempt.firstBroadcastAt && ['broadcasting', 'submitted'].includes(operation.status)) {
    return markBroadcast(database, operation.id, attempt.id, 'unknown', { reason: 'node_has_no_transaction' });
  }
  return operation;
}

/** Candidate validation, durable acceptance, and exact-byte broadcast/retry. */
export async function submitManifestOperation(operationId: string, options: ManifestPublicationOptions) {
  const database = options.database ?? prisma;
  const state = createManifestStateStore(database);
  const client = options.client ?? createTestnetClient();
  let operation = await database.cotaManifestOperation.findUnique({ where: { id: operationId } });
  if (!operation) throw new ManifestPublicationError('MANIFEST_NOT_FOUND', 404, 'The CoTA publication was not found.');
  operation = await refreshManifestOperation(operation, { ...options, client, database });
  if (operation.status === 'confirmed' || operation.status === 'submitted') return operation;
  if (operation.status === 'blocked') throw blockedError(operation);
  unsignedTransaction(operation);

  if (!operation.acceptedAttemptId) {
    try {
      let signed: ccc.Transaction;
      if (options.signedTransaction) {
        try { signed = ccc.Transaction.from(options.signedTransaction); } catch { throw signatureInvalid(); }
      } else {
        const retry = await database.cotaManifestSignedAttempt.findFirst({
          where: { operationId, preflight: { in: ['pending', 'unavailable', 'passed'] } }, orderBy: { createdAt: 'desc' },
        });
        if (retry) signed = ccc.Transaction.from(retry.signedTransaction as unknown as ccc.TransactionLike);
        else if (options.signer) {
          if (!SERVICE_KINDS.has(operation.kind)) throw new ManifestPublicationError('MANIFEST_OWNER_APPROVAL_REQUIRED', 403,
            'This operation requires approval from the connected owner wallet.');
          try { signed = await options.signer.signTransaction(unsignedTransaction(operation).clone()); }
          catch { throw unavailable('MANIFEST_SIGNER_UNAVAILABLE'); }
        } else throw new ManifestPublicationError('MANIFEST_SIGNATURE_REQUIRED', 422, 'Approve the prepared CoTA manifest operation in your wallet first.');
      }
      if (signed.hash() !== operation.txHash || signed.toBytes().length > 1_000_000) throw signatureInvalid();
      const attempt = await state.recordSignedAttempt(operation.id, { signedTransaction: jsonTransaction(signed),
        serializedTransaction: ccc.hexFrom(signed.toBytes()), txHash: signed.hash() });
      if (attempt.preflight === 'invalid') throw signatureInvalid();
      if (attempt.preflight === 'unsupported') throw planUnsupported();
      try { await validateCandidate(operation, signed, options); }
      catch (error) {
        if (attempt.preflight === 'passed') {
          await state.block(operation.id, { code: 'MANIFEST_PREVIOUS_BINDING_MISMATCH' });
          throw reconciliationRequired();
        }
        await state.finishPreflight(attempt.id, 'invalid', { code: 'MANIFEST_SIGNED_BINDING_INVALID' });
        throw error instanceof ManifestPublicationError ? error : signatureInvalid();
      }
      if (attempt.preflight !== 'passed') {
        try { await client.sendTransactionDry(signed); }
        catch (error) {
          const failure = manifestPreflightFailure(error);
          await state.finishPreflight(attempt.id, failure.outcome, failure.diagnostics);
          if (failure.outcome === 'invalid') throw signatureInvalid(failure.diagnostics);
          if (failure.outcome === 'unsupported') throw planUnsupported(failure.diagnostics);
          throw unavailable('MANIFEST_PREFLIGHT_UNAVAILABLE', failure.diagnostics);
        }
        await state.finishPreflight(attempt.id, 'passed');
      }
      operation = await state.acceptAttempt(operation.id, attempt.id);
    } catch (error) {
      if (!(error instanceof PublicationConflictError)) throw error;
      const current = await database.cotaManifestOperation.findUnique({ where: { id: operationId } });
      if (!current?.acceptedAttemptId) throw reconciliationRequired();
      operation = current;
    }
  }

  // A winning concurrent request may already have sent/confirmed this plan.
  operation = await refreshManifestOperation(operation, { ...options, client, database });
  if (operation.status === 'confirmed' || operation.status === 'submitted') return operation;
  if (operation.status === 'blocked') throw blockedError(operation);
  let persisted;
  try { persisted = await state.beginBroadcast(operation.id); }
  catch (error) { return completedAfterConflict(database, operation.id, error); }
  const signed = ccc.Transaction.from(persisted.attempt.signedTransaction as unknown as ccc.TransactionLike);
  try { await validateCandidate(persisted.operation, signed, options); }
  catch {
    await state.block(operation.id, { code: 'MANIFEST_ACCEPTED_BINDING_MISMATCH' });
    throw reconciliationRequired();
  }
  try {
    const hash = await client.sendTransaction(signed, 'passthrough');
    if (hash !== persisted.attempt.txHash) throw new Error('Unexpected transaction hash');
  } catch (error) {
    const recorded = await markBroadcast(database, operation.id, persisted.attempt.id, 'unknown', { code: 'MANIFEST_SEND_UNCERTAIN', ...manifestPreflightFailure(error).diagnostics });
    if (recorded.status === 'confirmed') return recorded;
    try {
      const current = await refreshManifestOperation(persisted.operation, { ...options, client, database });
      if (current.status === 'confirmed' || current.status === 'submitted') return current;
    } catch (reconciliationError) {
      if (reconciliationError instanceof ManifestPublicationError && reconciliationError.status !== 503) throw reconciliationError;
    }
    throw unavailable('MANIFEST_SEND_UNCERTAIN');
  }
  return markBroadcast(database, operation.id, persisted.attempt.id, 'submitted');
}
