import { ccc } from '@ckb-ccc/core';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, CotaManifestOperation, CotaManifestEnrollment, User, Repository } from '@prisma/client';
import { prisma } from './db';
import { createTestnetClient } from './ckb-server';
import { cotaTypeForLock } from './cota';
import { parseJoyIdAddress } from './wallet-proof';
import { readPublicRepository } from './public-repository';
import { buildManifest, ManifestBinding, ManifestEnvelope, MANIFEST_PROTOCOL, restoreIssuedManifest } from './cota-manifest';
import { chainHex, confirmedCotaCell, cotaRoot, cotaProofRpc, outpoint,
  prepareManifestMint, prepareManifestClaim, prepareManifestUpdate, validateManifestSigned,
  verifyManifestMint, verifyManifestClaim } from './cota-manifest-chain';
import { createManifestStateStore } from './cota-manifest-state';
import { manifestFeatureEnabled, manifestIssuer, transactionJson } from './cota-manifest-config';
import { refreshManifestOperation, submitManifestOperation } from './cota-manifest-publication';
import { reconcileManifestBackups } from './cota-manifest-backups';

const store = createManifestStateStore(prisma);
const pendingStatuses = ['building', 'awaiting_signature', 'validating', 'signed_ready', 'broadcasting', 'submitted', 'unknown', 'blocked'];
const toTransaction = (value: unknown) => ccc.Transaction.from(value as ccc.TransactionLike);
const planOf = (operation: CotaManifestOperation) => operation.plan as unknown as { envelope: ManifestEnvelope; outputType: string; recordSnapshot?: Snapshot };
type Snapshot = { owner: string; username: string; repositories: unknown[] };

async function account(githubId: string) {
  const user = await prisma.user.findUnique({ where: { githubId } });
  if (!user?.ckbAddress || !user.ckbAddressVerifiedAt) throw new Error('Verify your JoyID wallet before preparing a CoTA manifest.');
  const registration = await prisma.cotaRegistration.findUnique({ where: { userId: user.id } });
  if (registration?.status !== 'confirmed' || registration.address !== user.ckbAddress) throw new Error('Activate your user-owned CoTA identity first.');
  return user;
}

function snapshotOf(user: User, repositories: Repository[]): Snapshot {
  return { owner: user.ckbAddress || '', username: user.githubUsername || '', repositories: repositories.map(repo => ({
    id: repo.id, numericId: repo.githubNumericId, name: repo.fullName, cid: repo.lastBackupCid,
    anchor: repo.ckbCellOutpoint, txHash: repo.ckbTxHash, commits: repo.commitCount,
  })) };
}
const repositoriesFor = (userId: string, database: Pick<typeof prisma, 'repository'> = prisma) =>
  database.repository.findMany({ where: { userId, isBackedUp: true, isPrivate: false }, orderBy: { id: 'asc' } });

async function snapshotCheck(database: Prisma.TransactionClient, user: User, snapshot: Snapshot, includeBackups: boolean) {
  const current = await database.user.findUnique({ where: { id: user.id } });
  if (!current?.ckbAddressVerifiedAt || current.ckbAddress !== user.ckbAddress) throw new Error('The verified wallet changed while preparing the manifest.');
  if (includeBackups && !isDeepStrictEqual(snapshotOf(current, await repositoriesFor(user.id, database)), snapshot)) {
    throw new Error('Public backup records changed while preparing the manifest. Retry preparation.');
  }
  const legacy = await database.cotaUpdate.findFirst({ where: { userId: user.id, protocol: 'rivet-witness-v1', status: { in: ['prepared', 'submitted'] } } });
  if (legacy) throw new Error('Complete your saved signed-witness proof before preparing a CoTA manifest.');
}

async function currentManifest(user: User, binding: ManifestBinding, client: ccc.Client, token?: string, includeBackups = true) {
  // Bootstrap the metadata pair with identity only. Legacy backup references
  // can be refreshed independently, then included in an owner-approved update.
  const repositories = includeBackups ? await repositoriesFor(user.id) : [];
  if (repositories.length > 127) throw new Error('This manifest currently supports up to 127 public backup records.');
  const backups = [];
  // External reads happen outside database transactions. Small batches keep RPC
  // and GitHub requests bounded while avoiding one slow request per DB lock.
  for (let offset = 0; offset < repositories.length; offset += 4) {
    backups.push(...await Promise.all(repositories.slice(offset, offset + 4).map(async repo => {
      if (!repo.githubNumericId) throw new Error(`Run a fresh backup of ${repo.fullName} to record its immutable GitHub ID before manifest sync.`);
      const publicRepo = await readPublicRepository(repo.fullName, token);
      if (!publicRepo.ok || String(publicRepo.repository.id) !== repo.githubNumericId) throw new Error('A public repository identity or visibility could not be verified.');
      if (!repo.ckbTxHash || !repo.ckbCellOutpoint || !repo.lastBackupCid) throw new Error('A completed backup is missing its proof references.');
      const match = /^(0x[0-9a-f]{64}):(0|[1-9][0-9]*)$/i.exec(repo.ckbCellOutpoint);
      if (!match || match[1] !== repo.ckbTxHash) throw new Error('A saved backup anchor outpoint is invalid.');
      const index = Number(match[2]);
      if (!Number.isSafeInteger(index) || index > 0xffffffff) throw new Error('A saved backup anchor outpoint is invalid.');
      const anchor = await client.getTransaction(repo.ckbTxHash);
      if (anchor?.status !== 'committed') throw new Error('A public backup anchor is awaiting confirmation.');
      return { repositoryId: repo.githubNumericId, repository: repo.fullName, ipfsCid: repo.lastBackupCid,
        merkleRoot: chainHex(anchor.transaction.outputsData[index], 32), anchorOutpoint: repo.ckbCellOutpoint, commitCount: repo.commitCount };
    })));
  }
  return { ...buildManifest({ ...binding, githubUsername: user.githubUsername || user.githubId, backups }), snapshot: snapshotOf(user, repositories) };
}

function bindingFor(user: User, enrollment: CotaManifestEnrollment): ManifestBinding {
  const indexes = enrollment.tokenIndexes as unknown as [number, number];
  return { network: 'ckb-testnet', ownerLockHash: enrollment.ownerLockHash, issuerLockHash: enrollment.issuerLockHash,
    githubId: user.githubId, collectionId: enrollment.collectionId, indexes };
}

async function validateOperation(unsigned: ccc.Transaction, signed: ccc.Transaction, operation: CotaManifestOperation, client: ccc.Client) {
  validateManifestSigned(unsigned, signed);
  const { envelope, outputType } = planOf(operation);
  if (signed.getWitnessArgs(0)?.outputType !== outputType) throw new Error('The approved transaction changes the manifest records.');
  const input = unsigned.inputs[0];
  const cell = ccc.Cell.from({ outPoint: input.previousOutput, cellOutput: input.cellOutput!, outputData: input.outputData! });
  if (operation.kind === 'issue') {
    const owner = await ccc.Address.fromString((operation.snapshot as unknown as Snapshot).owner, client);
    verifyManifestMint(cell, owner.script, envelope, signed);
  } else if (operation.kind === 'claim') {
    const enrollment = await prisma.cotaManifestEnrollment.findUnique({ where: { userId: operation.userId! } });
    const issuer = await manifestIssuer(client);
    if (!enrollment?.issuanceTxHash || issuer.lock.hash() !== envelope.issuerLockHash) throw new Error('The manifest issuance binding changed.');
    const issuance = await client.getTransaction(enrollment.issuanceTxHash);
    if (issuance?.status !== 'committed') throw new Error('The manifest issuance is awaiting confirmation.');
    verifyManifestClaim(cell, issuer.lock, envelope, issuance.transaction, signed);
  } else {
    // The update's two CoTA roots and semantic envelope were verified during
    // preparation. Raw transaction + all non-lock witnesses are immutable here.
    if (operation.kind !== 'update') throw new Error('Unknown CoTA manifest operation.');
  }
}

async function refreshOperation(operation: CotaManifestOperation, client: ccc.Client) {
  const refreshed = await refreshManifestOperation(operation, { client,
    validateSigned: (unsigned, signed, saved) => validateOperation(unsigned, signed, saved, client) });
  if (refreshed.status === 'confirmed' && refreshed.userId) {
    if (refreshed.kind === 'issue') await prisma.cotaManifestEnrollment.updateMany({
      where: { userId: refreshed.userId, issuanceOperationId: refreshed.id }, data: { status: 'issued', issuanceTxHash: refreshed.txHash },
    });
    if (refreshed.kind === 'claim') await prisma.cotaManifestEnrollment.update({ where: { userId: refreshed.userId }, data: { status: 'claimed', claimTxHash: refreshed.txHash } });
  }
  return refreshed;
}

function publicOperation(operation: CotaManifestOperation) {
  const unsigned = operation.unsignedTransaction ? toTransaction(operation.unsignedTransaction) : null;
  const status = operation.status === 'awaiting_signature' ? 'prepared'
    : ['building', 'validating', 'signed_ready', 'broadcasting', 'unknown'].includes(operation.status) ? 'accepted' : operation.status;
  return { id: operation.id, kind: operation.kind, status, root: operation.root,
    transaction: status === 'prepared' && operation.kind !== 'issue' && !operation.acceptedAttemptId ? operation.unsignedTransaction : null,
    feeCKB: unsigned ? ccc.fixedPointToString(unsigned.inputs[0].cellOutput!.capacity - unsigned.outputs[0].capacity) : null,
    explorerUrl: operation.txHash ? `https://pudge.explorer.nervos.org/transaction/${operation.txHash}` : null,
    error: operation.status === 'blocked' ? 'This saved CoTA operation failed script validation and needs review.' : null };
}

export async function getManifestState(githubId: string, client = createTestnetClient()) {
  const off = { enabled: false, nextStep: 'blocked', operation: null, confirmed: null, latest: null, hasChanges: false };
  if (!manifestFeatureEnabled()) return off;
  let issuer: Awaited<ReturnType<typeof manifestIssuer>>;
  try { issuer = await manifestIssuer(client); } catch { return { ...off, error: 'CoTA manifest issuer setup is not complete yet.' }; }
  const user = await account(githubId);
  let operation = await prisma.cotaManifestOperation.findFirst({ where: { userId: user.id, status: { in: pendingStatuses } }, orderBy: { createdAt: 'desc' } });
  if (operation) operation = await refreshOperation(operation, client);
  if (operation?.status === 'confirmed') operation = null;
  let enrollment = await prisma.cotaManifestEnrollment.findUnique({ where: { userId: user.id } });
  if (enrollment?.status === 'issuing' && enrollment.issuanceOperationId) {
    const issuance = await prisma.cotaManifestOperation.findUnique({ where: { id: enrollment.issuanceOperationId } });
    if (issuance?.status === 'confirmed') enrollment = await prisma.cotaManifestEnrollment.update({ where: { userId: user.id }, data: { status: 'issued', issuanceTxHash: issuance.txHash } });
  }
  const confirmed = await prisma.cotaManifestOperation.findFirst({ where: { userId: user.id, kind: { in: ['claim', 'update'] }, status: 'confirmed' }, orderBy: { createdAt: 'desc' } });
  if (confirmed?.kind === 'claim' && enrollment?.status !== 'claimed') enrollment = await prisma.cotaManifestEnrollment.update({ where: { userId: user.id }, data: { status: 'claimed', claimTxHash: confirmed.txHash } });
  const repositories = await repositoriesFor(user.id);
  const currentSnapshot = snapshotOf(user, repositories);
  const hasChanges = !confirmed || !isDeepStrictEqual(planOf(confirmed).recordSnapshot || confirmed.snapshot, currentSnapshot);
  let nextStep = !enrollment ? 'issue' : enrollment.status === 'claimed' ? hasChanges ? 'update' : 'ready' : 'claim';
  if (operation && ['building', 'validating', 'broadcasting', 'submitted'].includes(operation.status)) nextStep = 'wait';
  if (operation?.status === 'blocked' || (enrollment && (enrollment.issuerLockHash !== issuer.lock.hash() || enrollment.collectionId !== issuer.collectionId))) nextStep = 'blocked';
  return { enabled: true, nextStep, operation: operation ? publicOperation(operation) : null,
    confirmed: confirmed ? { root: confirmed.root!, backupCount: planOf(confirmed).envelope.records.filter(entry => entry.record.kind === 'backup').length,
      explorerUrl: `https://pudge.explorer.nervos.org/transaction/${confirmed.txHash}`, exportUrl: '/api/user/cota/manifest/proof' } : null,
    latest: { root: null, backupCount: repositories.length }, hasChanges };
}

export async function prepareManifest(githubId: string, token?: string, client = createTestnetClient()) {
  if (!manifestFeatureEnabled()) throw new Error('CoTA manifests are not enabled.');
  const user = await account(githubId), issuer = await manifestIssuer(client);
  const pending = await prisma.cotaManifestOperation.findFirst({ where: { userId: user.id, status: { in: pendingStatuses } }, orderBy: { createdAt: 'desc' } });
  if (pending && pending.status !== 'building') { await refreshOperation(pending, client); return getManifestState(githubId, client); }
  const owner = await parseJoyIdAddress(user.ckbAddress!, client);
  const enrollment = await prisma.cotaManifestEnrollment.findUnique({ where: { userId: user.id } });
  if (enrollment && (enrollment.ownerLockHash !== owner.script.hash() || enrollment.issuerLockHash !== issuer.lock.hash() || enrollment.collectionId !== issuer.collectionId)) {
    throw new Error('The saved CoTA manifest owner or issuer differs from the configured account.');
  }
  const kind = !enrollment ? 'issue' : enrollment.status === 'claimed' ? 'update' : 'claim';
  if (kind === 'update') await reconcileManifestBackups(user, await repositoriesFor(user.id), { database: prisma, client, token });
  const cell = await confirmedCotaCell(kind === 'issue' ? issuer.lock : owner.script, client);
  const snapshot = snapshotOf(user, await repositoriesFor(user.id));
  await snapshotCheck(prisma, user, snapshot, true);
  const streamIdentity = { network: 'ckb-testnet', cotaScriptHash: cotaTypeForLock(cell.cellOutput.lock).hash(), sourceOutpoint: outpoint(cell) };
  await store.reconcileHead(streamIdentity);
  const reserved = await store.reserve({ ...streamIdentity, userId: user.id, kind, protocol: MANIFEST_PROTOCOL, snapshot: snapshot as unknown as Prisma.InputJsonValue });
  if (reserved.existing) {
    if (reserved.operation.userId !== user.id) throw new Error('Another sponsored metadata issuance is confirming. Retry shortly.');
    return getManifestState(githubId, client);
  }
  try {
    let envelope: ManifestEnvelope, outputType: string, preparedSnapshot = snapshot, transaction: ccc.Transaction;
    if (kind === 'issue') {
      const definition = await cotaProofRpc<{ issued: number; configure: string; total: number }>('get_define_info', { cota_id: issuer.collectionId! });
      if (!Number.isSafeInteger(definition.issued) || definition.issued < 0 || definition.issued > 0xfffffffe) throw new Error('The CoTA manifest collection is full or not indexed.');
      const manifest = await currentManifest(user, { network: 'ckb-testnet', ownerLockHash: owner.script.hash(), issuerLockHash: issuer.lock.hash(),
        githubId, collectionId: issuer.collectionId!, indexes: [definition.issued, definition.issued + 1] }, client, token, false);
      ({ envelope, outputType } = manifest); preparedSnapshot = manifest.snapshot;
      transaction = await prepareManifestMint(cell, owner.script, envelope, outputType, client);
    } else if (kind === 'claim') {
      if (!enrollment?.issuanceTxHash) throw new Error('The sponsored metadata issuance is awaiting confirmation.');
      const issuance = await client.getTransaction(enrollment.issuanceTxHash);
      if (issuance?.status !== 'committed') throw new Error('The sponsored metadata issuance is awaiting confirmation.');
      // JSONB preserves values, not object field order. Reuse the exact issued
      // witness bytes and compare the saved enrollment by value.
      outputType = issuance.transaction.getWitnessArgs(0)?.outputType || '';
      envelope = restoreIssuedManifest(outputType, enrollment.initialManifest, bindingFor(user, enrollment));
      transaction = await prepareManifestClaim(cell, issuer.lock, envelope, outputType, issuance.transaction, client);
      // The claim approves the immutable issuance snapshot, even if another
      // ordinary backup completed after those metadata records were issued.
      const issuanceOp = await prisma.cotaManifestOperation.findUnique({ where: { id: enrollment.issuanceOperationId! } });
      preparedSnapshot = (planOf(issuanceOp!).recordSnapshot || issuanceOp!.snapshot) as unknown as Snapshot;
    } else {
      const manifest = await currentManifest(user, bindingFor(user, enrollment!), client, token);
      ({ envelope, outputType } = manifest); preparedSnapshot = manifest.snapshot;
      transaction = await prepareManifestUpdate(cell, envelope, outputType, client);
      if (transaction.outputsData[0] === cell.outputData) {
        await store.abandonBuild(reserved.operation.id, { reason: 'already_synchronized' });
        return getManifestState(githubId, client);
      }
    }
    await store.commitPlan(reserved.operation.id, {
      unsignedTransaction: transactionJson(transaction), serializedUnsignedTransaction: ccc.hexFrom(transaction.toBytes()), txHash: transaction.hash(),
      root: envelope.manifestRoot, previousRoot: cotaRoot(cell), plan: { envelope, outputType, recordSnapshot: preparedSnapshot } as unknown as Prisma.InputJsonValue,
      assertSnapshot: async database => {
        await snapshotCheck(database, user, preparedSnapshot, kind === 'update');
        if (kind === 'issue') {
          if (issuer.limit > 0 && await database.cotaManifestEnrollment.count() >= issuer.limit) throw new Error('The sponsored CoTA metadata enrollment limit has been reached.');
          await database.cotaManifestEnrollment.create({ data: {
            userId: user.id, ownerLockHash: envelope.ownerLockHash, issuerLockHash: envelope.issuerLockHash, collectionId: envelope.collectionId,
            tokenIndexes: envelope.indexes, initialManifest: envelope as unknown as Prisma.InputJsonValue,
            issuanceOperationId: reserved.operation.id, status: 'issuing',
          } });
        }
      },
    });
  } catch (error) {
    await store.abandonBuild(reserved.operation.id, { reason: 'preparation_failed' }).catch(() => {});
    throw error;
  }
  return getManifestState(githubId, client);
}

export async function submitManifest(githubId: string, operationId: string, signedTransaction?: ccc.TransactionLike, client = createTestnetClient()) {
  if (!manifestFeatureEnabled()) throw new Error('CoTA manifests are not enabled.');
  const user = await account(githubId);
  const operation = await prisma.cotaManifestOperation.findFirst({ where: { id: operationId, userId: user.id } });
  if (!operation) throw new Error('CoTA manifest operation not found.');
  if (operation.status === 'building') return prepareManifest(githubId, undefined, client);
  if (operation.status === 'blocked') throw new Error('The saved CoTA manifest operation requires review.');
  const issuer = await manifestIssuer(client);
  const owner = await parseJoyIdAddress(user.ckbAddress!, client);
  if (planOf(operation).envelope.ownerLockHash !== owner.script.hash() || planOf(operation).envelope.issuerLockHash !== issuer.lock.hash()) throw new Error('The verified manifest wallet or issuer changed.');
  await submitManifestOperation(operation.id, { signedTransaction: operation.kind === 'issue' ? undefined : signedTransaction,
    signer: operation.kind === 'issue' ? issuer.signer : undefined, client,
    validateSigned: (unsigned, signed, saved) => validateOperation(unsigned, signed, saved, client) });
  const refreshed = (await prisma.cotaManifestOperation.findUnique({ where: { id: operation.id } }))!;
  await refreshOperation(refreshed, client);
  return getManifestState(githubId, client);
}

export async function exportManifestProof(githubId: string, client = createTestnetClient()) {
  const user = await account(githubId);
  const enrollment = await prisma.cotaManifestEnrollment.findUnique({ where: { userId: user.id } });
  const operation = await prisma.cotaManifestOperation.findFirst({ where: { userId: user.id, kind: { in: ['claim', 'update'] }, status: 'confirmed' }, orderBy: { createdAt: 'desc' } });
  if (!operation || !enrollment?.issuanceTxHash || !enrollment.claimTxHash) throw new Error('A confirmed CoTA manifest proof is not available yet.');
  return { protocol: 'rivet-cota-manifest-proof-v1', network: 'ckb-testnet', binding: bindingFor(user, enrollment),
    issuerLockHash: enrollment.issuerLockHash, issuanceTxHash: enrollment.issuanceTxHash, claimTxHash: enrollment.claimTxHash,
    manifestTxHash: operation.txHash, manifestRoot: operation.root };
}
