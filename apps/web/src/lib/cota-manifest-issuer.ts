import { createECDH } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ccc } from '@ckb-ccc/core';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './db';
import { createTestnetClient } from './ckb-server';
import { COTA_TESTNET, cotaTypeForLock, prepareCotaRegistration, registryRpc } from './cota';
import { manifestIssuer, transactionJson } from './cota-manifest-config';
import { cotaRoot, outpoint, prepareManifestDefine, verifyManifestDefine } from './cota-manifest-chain';
import { createManifestStateStore, CotaManifestOperation, ManifestStateStore } from './cota-manifest-state';
import { refreshManifestOperation, submitManifestOperation } from './cota-manifest-publication';

const NETWORK = 'ckb-testnet';
const MAX_FEE = ccc.fixedPointFrom('0.01');
type Issuer = Awaited<ReturnType<typeof manifestIssuer>>;
type Options = {
  database?: PrismaClient; client?: ReturnType<typeof createTestnetClient>; store?: ManifestStateStore;
  issuer?: Issuer; register?: typeof prepareCotaRegistration; define?: typeof prepareManifestDefine;
  registry?: typeof registryRpc; refresh?: typeof refreshManifestOperation; submit?: typeof submitManifestOperation;
};

export async function createManifestIssuerKeyFile(filename: string, client = createTestnetClient()) {
  const pair = createECDH('secp256k1'); pair.generateKeys();
  const key = `0x${pair.getPrivateKey().toString('hex').padStart(64, '0')}`;
  const signer = new ccc.SignerCkbPrivateKey(client, key);
  const address = await signer.getRecommendedAddress();
  try { await writeFile(filename, `COTA_MANIFEST_ISSUER_PRIVATE_KEY="${key}"\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new Error('The issuer key file already exists. It was not changed.');
    throw new Error('The issuer key file could not be saved.');
  }
  return { filename, address };
}

function snapshot(operation: CotaManifestOperation) {
  const value = operation.snapshot;
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('The issuer setup snapshot is invalid.');
  return value as Record<string, Prisma.JsonValue>;
}
function issuerPlan(operation: CotaManifestOperation) {
  return operation.plan && typeof operation.plan === 'object' && !Array.isArray(operation.plan) ? operation.plan as Record<string, Prisma.JsonValue> : {};
}
function sourceCell(unsigned: ccc.Transaction) {
  const first = unsigned.inputs[0];
  if (!first?.cellOutput || first.outputData === undefined) throw new Error('The saved issuer source cell is incomplete.');
  return ccc.Cell.from({ outPoint: first.previousOutput, cellOutput: first.cellOutput, outputData: first.outputData });
}
function fee(transaction: ccc.Transaction) {
  if (transaction.inputs.some(input => !input.cellOutput)) throw new Error('The saved issuer transaction inputs are incomplete.');
  const amount = transaction.inputs.reduce((total, input) => total + input.cellOutput!.capacity, 0n)
    - transaction.outputs.reduce((total, output) => total + output.capacity, 0n);
  if (amount < 0n || amount > MAX_FEE) throw new Error('The issuer setup transaction exceeds its fee limit.');
  return amount;
}

/** Validate both local candidates and actual committed witnesses. */
export function validateIssuerSetupSigned(unsigned: ccc.Transaction, signed: ccc.Transaction, operation: CotaManifestOperation) {
  const saved = snapshot(operation);
  if (operation.userId !== null || !['issuer-register', 'issuer-define'].includes(operation.kind)
    || unsigned.hash() !== signed.hash() || signed.witnesses.length !== unsigned.witnesses.length) throw new Error('The issuer setup transaction differs from its saved plan.');
  const lock = ccc.Script.from(saved.issuerLock as unknown as ccc.ScriptLike);
  if (lock.hash() !== saved.issuerLockHash) throw new Error('The saved issuer binding is inconsistent.');
  if (operation.kind === 'issuer-register') {
    // Registration is already fully signed when saved. Preserve every sponsor
    // witness, including signatures outside the registry input's group.
    if (signed.witnesses.some((witness, index) => witness !== unsigned.witnesses[index])) throw new Error('The issuer registration signatures differ from the saved bytes.');
    const input = sourceCell(unsigned);
    const owner = signed.outputs[1];
    if (!input.cellOutput.type?.eq(COTA_TESTNET.registry) || !input.cellOutput.lock.eq(COTA_TESTNET.registryLock)
      || !signed.outputs[0]?.lock.eq(input.cellOutput.lock) || !signed.outputs[0]?.type?.eq(input.cellOutput.type)
      || !owner?.lock.eq(lock) || !owner.type?.eq(cotaTypeForLock(lock))
      || signed.outputsData[1] !== `0x02${'00'.repeat(32)}` || owner.capacity < ccc.fixedPointFrom(150)) throw new Error('The sponsored issuer output does not match its saved owner.');
    if (unsigned.inputs.length < 2 || !unsigned.inputs.slice(1).some(input => input.cellOutput?.lock.hash() === saved.sponsorLockHash)
      || !signed.witnesses.slice(1).some(witness => witness !== '0x')) throw new Error('The sponsored registration signature is missing.');
  } else {
    const expected = unsigned.getWitnessArgs(0), actual = signed.getWitnessArgs(0);
    if (!actual?.lock || actual.lock === '0x' || actual.inputType !== expected?.inputType || actual.outputType !== expected?.outputType
      || signed.witnesses.some((witness, index) => index > 0 && witness !== unsigned.witnesses[index])) throw new Error('The issuer definition signature differs from its saved plan.');
    const checked = verifyManifestDefine(sourceCell(unsigned), signed);
    if (checked.collectionId !== issuerPlan(operation).collectionId) throw new Error('The issuer collection differs from its saved definition.');
  }
  const amount = fee(unsigned);
  if (amount < BigInt(signed.toBytes().length)) throw new Error('The issuer setup transaction fee is insufficient.');
}

function publicOperation(operation: CotaManifestOperation) {
  return { id: operation.id, kind: operation.kind, stage: operation.status, txHash: operation.txHash,
    feeCKB: issuerPlan(operation).feeCKB ?? null, collectionId: issuerPlan(operation).collectionId ?? null };
}
async function context(options: Options) {
  const client = options.client || createTestnetClient();
  if (client.addressPrefix !== 'ckt') throw new Error('Issuer setup supports CKB testnet only.');
  const database = options.database || prisma;
  const issuer = options.issuer || await manifestIssuer(client, false);
  const address = await ccc.Address.fromScript(issuer.lock, client);
  return { client, database, issuer, store: options.store || createManifestStateStore(database), address: address.toString() };
}
function ownedOperation(operation: CotaManifestOperation, issuer: Issuer) {
  if (operation.userId !== null || !['issuer-register', 'issuer-define'].includes(operation.kind) || snapshot(operation).issuerLockHash !== issuer.lock.hash()) {
    throw new Error('The operation does not belong to the configured issuer setup.');
  }
  return operation;
}
async function latestOperation(database: PrismaClient, issuer: Issuer) {
  return database.cotaManifestOperation.findFirst({ where: { userId: null, kind: { in: ['issuer-register', 'issuer-define'] },
    status: { not: 'abandoned' }, snapshot: { path: ['issuerLockHash'], equals: issuer.lock.hash() } }, orderBy: { createdAt: 'desc' } });
}

export async function manifestIssuerSetupStatus(id?: string, options: Options = {}) {
  const current = await context(options);
  let operation = id ? await current.database.cotaManifestOperation.findUnique({ where: { id } }) : await latestOperation(current.database, current.issuer);
  if (operation) {
    ownedOperation(operation, current.issuer);
    operation = await (options.refresh || refreshManifestOperation)(operation, { client: current.client, database: current.database, validateSigned: validateIssuerSetupSigned });
  }
  const collectionId = operation?.kind === 'issuer-define' && operation.status === 'confirmed' ? issuerPlan(operation).collectionId : null;
  return { address: current.address, issuerLockHash: current.issuer.lock.hash(), collectionId,
    stage: operation ? operation.status : 'not_prepared', operation: operation ? publicOperation(operation) : null };
}

export async function prepareManifestIssuerSetup(options: Options = {}) {
  const current = await context(options);
  const { client, database, issuer, store } = current;
  const last = await latestOperation(database, issuer);
  if (last && last.status !== 'building') {
    const refreshed = await (options.refresh || refreshManifestOperation)(last, { client, database, validateSigned: validateIssuerSetupSigned });
    if (refreshed.status !== 'confirmed' || refreshed.kind === 'issuer-define') {
      return { address: current.address, issuerLockHash: issuer.lock.hash(), collectionId: refreshed.kind === 'issuer-define' && refreshed.status === 'confirmed' ? issuerPlan(refreshed).collectionId : null,
        stage: refreshed.status, operation: publicOperation(refreshed) };
    }
  }
  let cell = await client.findSingletonCellByType(cotaTypeForLock(issuer.lock));
  let kind: 'issuer-register' | 'issuer-define';
  let streamCell: ccc.Cell;
  let sponsor: ccc.SignerCkbPrivateKey | undefined;
  if (cell) {
    if (!cell.cellOutput.lock.eq(issuer.lock) || !cell.cellOutput.type?.eq(cotaTypeForLock(issuer.lock))) throw new Error('The issuer CoTA cell has a different owner or type.');
    if ((await client.getTransaction(cell.outPoint.txHash))?.status !== 'committed') throw new Error('The issuer CoTA cell is awaiting confirmation.');
    cotaRoot(cell); kind = 'issuer-define'; streamCell = cell;
  } else {
    if (process.env.COTA_SPONSOR_ENABLED !== 'true' || !process.env.COTA_SPONSOR_PRIVATE_KEY) throw new Error('Enable and configure testnet sponsorship before registering the issuer.');
    const limit = Number(process.env.COTA_SPONSOR_MAX_REGISTRATIONS || '10');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('The sponsorship registration limit is invalid.');
    const [registrations, issuerRegistrations] = await Promise.all([
      database.cotaRegistration.count({ where: { transaction: { not: Prisma.DbNull } } }),
      database.cotaManifestOperation.count({ where: { kind: 'issuer-register', status: { not: 'abandoned' },
        ...(last?.kind === 'issuer-register' && last.status === 'building' ? { id: { not: last.id } } : {}) } }),
    ]);
    if (registrations + issuerRegistrations >= limit) throw new Error('The sponsorship registration limit has been reached.');
    sponsor = new ccc.SignerCkbPrivateKey(client, process.env.COTA_SPONSOR_PRIVATE_KEY);
    if ((await sponsor.getRecommendedAddressObj()).script.eq(issuer.lock)) throw new Error('The manifest issuer must use a dedicated key separate from the sponsor.');
    const registered = await (options.registry || registryRpc)<{ registered: boolean }>('check_registered_lock_hashes', issuer.lock.hash());
    if (registered.registered !== false) throw new Error('The issuer is already registered; wait for its CoTA cell to appear.');
    const registry = await client.findSingletonCellByType(COTA_TESTNET.registry);
    if (!registry || !registry.cellOutput.lock.eq(COTA_TESTNET.registryLock) || !registry.cellOutput.type?.eq(COTA_TESTNET.registry)
      || (await client.getTransaction(registry.outPoint.txHash))?.status !== 'committed') throw new Error('The committed CoTA registry cell is unavailable.');
    kind = 'issuer-register'; streamCell = registry;
  }
  const stream = { network: NETWORK, cotaScriptHash: streamCell.cellOutput.type!.hash(), sourceOutpoint: outpoint(streamCell) };
  await store.reconcileHead(stream);
  const reserved = await store.reserve({ ...stream, userId: null, kind, snapshot: {
    issuerLockHash: issuer.lock.hash(), issuerLock: { codeHash: issuer.lock.codeHash, hashType: issuer.lock.hashType, args: issuer.lock.args },
    sponsorLockHash: sponsor ? (await sponsor.getRecommendedAddressObj()).script.hash() : null,
  } });
  if (reserved.existing) {
    ownedOperation(reserved.operation, issuer);
    return { address: current.address, issuerLockHash: issuer.lock.hash(), collectionId: null, stage: reserved.operation.status, operation: publicOperation(reserved.operation) };
  }
  try {
    let transaction: ccc.Transaction, collectionId: string | null = null;
    if (kind === 'issuer-register') transaction = await (options.register || prepareCotaRegistration)(client, issuer.lock, sponsor!);
    else { const defined = await (options.define || prepareManifestDefine)(cell!, client); transaction = defined.transaction; collectionId = defined.collectionId; }
    if (!transaction.inputs[0].previousOutput.eq(streamCell.outPoint)) throw new Error('The CoTA source changed during issuer setup. Retry preparation.');
    const amount = fee(transaction);
    const plan = { collectionId, feeCKB: ccc.fixedPointToString(amount), issuerOutputIndex: kind === 'issuer-register' ? 1 : 0, successorOutputIndex: 0 };
    const candidate = { ...reserved.operation, plan } as CotaManifestOperation;
    if (kind === 'issuer-register') validateIssuerSetupSigned(transaction, transaction, candidate);
    else verifyManifestDefine(cell!, transaction);
    const saved = await store.commitPlan(reserved.operation.id, { unsignedTransaction: transactionJson(transaction), serializedUnsignedTransaction: ccc.hexFrom(transaction.toBytes()),
      txHash: transaction.hash(), previousRoot: cotaRoot(streamCell), root: `0x${transaction.outputsData[0].slice(4)}`, plan });
    return { address: current.address, issuerLockHash: issuer.lock.hash(), collectionId, stage: saved.status, operation: publicOperation(saved) };
  } catch (error) {
    await store.abandonBuild(reserved.operation.id, { stage: 'issuer-build-failed' }).catch(() => undefined);
    throw error;
  }
}

export async function submitManifestIssuerSetup(id: string, options: Options = {}) {
  const current = await context(options);
  const operation = await current.database.cotaManifestOperation.findUnique({ where: { id } });
  if (!operation) throw new Error('The issuer setup operation was not found.');
  ownedOperation(operation, current.issuer);
  const shared = { client: current.client, database: current.database, validateSigned: validateIssuerSetupSigned, successorOutputIndex: 0 };
  const result = await (options.submit || submitManifestOperation)(id, operation.kind === 'issuer-register'
    ? { ...shared, signedTransaction: operation.unsignedTransaction as unknown as ccc.TransactionLike }
    : { ...shared, signer: current.issuer.signer });
  return { address: current.address, issuerLockHash: current.issuer.lock.hash(), stage: result.status,
    collectionId: result.kind === 'issuer-define' && result.status === 'confirmed' ? issuerPlan(result).collectionId : null, operation: publicOperation(result) };
}
