import { ccc } from '@ckb-ccc/core';
import { TESTNET_SCRIPTS } from '@ckb-ccc/core/advanced';
import { cotaTypeForLock } from './cota';
import { ManifestBinding, ManifestEnvelope, parseManifestEnvelope, verifyManifestUpdate } from './cota-manifest';
import { cotaRoot, verifyManifestClaim, verifyManifestMint } from './cota-manifest-chain';

export const MANIFEST_PROOF_PROTOCOL = 'rivet-cota-manifest-proof-v1';
const MAX_TRANSACTIONS = 512;
const MAX_LINEAGE = 128;
const MAX_TRANSACTION_BYTES = 1_000_000;
const MAX_INPUTS = 64;

export type ManifestProofPackage = {
  protocol: typeof MANIFEST_PROOF_PROTOCOL;
  network: 'ckb-testnet';
  binding: ManifestBinding;
  issuanceTxHash: string;
  claimTxHash: string;
  manifestTxHash: string;
  manifestRoot?: string;
  issuerLockHash?: string;
};

type ChainClient = Pick<ccc.Client, 'addressPrefix' | 'getTransaction'>;
type VerifyOptions = {
  // Obtain this hash independently from the proof being verified. Otherwise
  // any issuer could impersonate Rivet's GitHub identity attestation.
  expectedIssuerLockHash: string;
  client: ChainClient;
  maxTransactions?: number;
  maxLineage?: number;
};

function object(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${description}.`);
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error('Unsupported CoTA manifest proof fields.');
  }
}

function hex(value: unknown, size: number, description: string) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${size * 2}}$`, 'i').test(value)) throw new Error(`Invalid ${description}.`);
  return value.toLowerCase();
}

function limit(value: number | undefined, maximum: number, description: string) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${description} limit.`);
  return value;
}

/** A proof package contains references, never a trusted copy of chain data. */
export function parseManifestProofPackage(value: unknown): ManifestProofPackage {
  const proof = object(value, 'CoTA manifest proof package');
  fields(proof, ['protocol', 'network', 'binding', 'issuanceTxHash', 'claimTxHash', 'manifestTxHash'], ['manifestRoot', 'issuerLockHash']);
  if (proof.protocol !== MANIFEST_PROOF_PROTOCOL || proof.network !== 'ckb-testnet') throw new Error('Unsupported CoTA manifest proof protocol or network.');
  const owner = object(proof.binding, 'CoTA manifest binding');
  fields(owner, ['network', 'ownerLockHash', 'issuerLockHash', 'githubId', 'collectionId', 'indexes']);
  if (owner.network !== proof.network || typeof owner.githubId !== 'string' || !/^[1-9][0-9]{0,29}$/.test(owner.githubId)) throw new Error('Invalid CoTA manifest identity binding.');
  if (!Array.isArray(owner.indexes) || owner.indexes.length !== 2
    || owner.indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index > 0xffffffff)
    || owner.indexes[0] >= owner.indexes[1]) throw new Error('Invalid CoTA manifest token pair.');
  return {
    protocol: MANIFEST_PROOF_PROTOCOL, network: 'ckb-testnet',
    binding: {
      network: 'ckb-testnet', ownerLockHash: hex(owner.ownerLockHash, 32, 'owner lock hash'),
      issuerLockHash: hex(owner.issuerLockHash, 32, 'issuer lock hash'), githubId: owner.githubId,
      collectionId: hex(owner.collectionId, 20, 'CoTA collection ID'), indexes: [owner.indexes[0], owner.indexes[1]],
    },
    issuanceTxHash: hex(proof.issuanceTxHash, 32, 'issuance transaction hash'),
    claimTxHash: hex(proof.claimTxHash, 32, 'claim transaction hash'),
    manifestTxHash: hex(proof.manifestTxHash, 32, 'manifest transaction hash'),
    ...(proof.manifestRoot !== undefined ? { manifestRoot: hex(proof.manifestRoot, 32, 'manifest root') } : {}),
    ...(proof.issuerLockHash !== undefined ? { issuerLockHash: hex(proof.issuerLockHash, 32, 'issuer lock hash') } : {}),
  };
}

function witnessEnvelope(transaction: ccc.Transaction, expected: ManifestBinding) {
  const witness = transaction.getWitnessArgs(0);
  if (!witness?.outputType || !witness.inputType || !witness.lock || witness.lock === '0x') {
    throw new Error('The confirmed transaction is missing its signed manifest witness.');
  }
  return { envelope: parseManifestEnvelope(witness.outputType, expected), witness };
}

function assertCotaCell(cell: ccc.Cell, lock: ccc.Script) {
  if (!cell.cellOutput.lock.eq(lock) || !cell.cellOutput.type?.eq(cotaTypeForLock(lock))) {
    throw new Error('A manifest source or output differs from the owner’s CoTA cell.');
  }
  cotaRoot(cell);
}

/**
 * Verify a confirmed snapshot using public CKB transaction data only. CKB's
 * reported committed status authenticates lock execution; this is not a header
 * verifier and does not make claims about GitHub's API or backup availability.
 */
export async function verifyManifestProofPackage(value: unknown, options: VerifyOptions) {
  const proof = parseManifestProofPackage(value);
  const trustedIssuer = hex(options?.expectedIssuerLockHash, 32, 'independently trusted issuer lock hash');
  if (trustedIssuer !== proof.binding.issuerLockHash || (proof.issuerLockHash && proof.issuerLockHash !== trustedIssuer)) {
    throw new Error('The proof issuer differs from the independently trusted Rivet issuer.');
  }
  if (options.client.addressPrefix !== 'ckt') throw new Error('CoTA manifest verification requires a CKB testnet client.');
  const maximumTransactions = limit(options.maxTransactions, MAX_TRANSACTIONS, 'transaction');
  const maximumLineage = limit(options.maxLineage, MAX_LINEAGE, 'CoTA lineage');
  const transactions = new Map<string, Promise<ccc.Transaction>>();
  const blocks = new Map<string, string>();
  async function committed(hash: string): Promise<ccc.Transaction> {
    const txHash = hex(hash, 32, 'referenced transaction hash');
    const cached = transactions.get(txHash);
    if (cached) return cached;
    if (transactions.size >= maximumTransactions) throw new Error('The proof exceeds the transaction verification limit.');
    const request = options.client.getTransaction(txHash).then(response => {
      if (response?.status !== 'committed') throw new Error(`A referenced transaction is not committed: ${txHash}.`);
      const transaction = ccc.Transaction.from(response.transaction);
      if (transaction.hash() !== txHash) throw new Error('CKB RPC returned a transaction with a different hash.');
      if (transaction.toBytes().length > MAX_TRANSACTION_BYTES || transaction.inputs.length > MAX_INPUTS
        || transaction.outputsData.length !== transaction.outputs.length) throw new Error('A referenced transaction exceeds the supported verification bounds.');
      if (response.blockHash) blocks.set(txHash, hex(response.blockHash, 32, 'committed block hash'));
      return transaction;
    });
    transactions.set(txHash, request);
    return request;
  }
  function output(transaction: ccc.Transaction, txHash: string, index: number): ccc.Cell {
    if (!Number.isSafeInteger(index) || index < 0 || index >= transaction.outputs.length) throw new Error('A referenced transaction output does not exist.');
    return ccc.Cell.from({ outPoint: { txHash, index }, cellOutput: transaction.outputs[index], outputData: transaction.outputsData[index] });
  }
  async function source(transaction: ccc.Transaction, index = 0) {
    const previous = transaction.inputs[index]?.previousOutput;
    if (!previous) throw new Error('The manifest transaction is missing its CoTA input.');
    return output(await committed(previous.txHash), previous.txHash, Number(previous.index));
  }

  // Derive scripts and every source cell from committed output data. Package
  // binding fields become meaningful only after the trusted issuer is checked.
  const issuance = await committed(proof.issuanceTxHash);
  const issuanceSource = await source(issuance);
  if (issuanceSource.cellOutput.lock.hash() !== trustedIssuer) throw new Error('The issuance did not spend the trusted issuer’s CoTA cell.');
  assertCotaCell(issuanceSource, issuanceSource.cellOutput.lock);
  const claim = await committed(proof.claimTxHash);
  const issuanceBlock = blocks.get(proof.issuanceTxHash);
  if (!issuanceBlock || !claim.headerDeps.some(header => header === issuanceBlock)) throw new Error('The CoTA claim does not reference the confirmed issuance block.');
  const owner = claim.outputs[0]?.lock;
  const joyId = TESTNET_SCRIPTS[ccc.KnownScript.JoyId];
  if (!owner || owner.hash() !== proof.binding.ownerLockHash || owner.codeHash !== joyId.codeHash || owner.hashType !== joyId.hashType) {
    throw new Error('The manifest owner is not the expected CKB testnet JoyID wallet.');
  }
  const issued = witnessEnvelope(issuance, proof.binding).envelope;
  verifyManifestMint(issuanceSource, owner, issued, issuance);
  const claimSource = await source(claim);
  assertCotaCell(claimSource, owner);
  const claimed = witnessEnvelope(claim, proof.binding).envelope;
  if (JSON.stringify(claimed) !== JSON.stringify(issued)) throw new Error('The owner claim differs from the issuer-attested initial manifest.');
  verifyManifestClaim(claimSource, issuanceSource.cellOutput.lock, issued, issuance, claim);

  const manifest = await committed(proof.manifestTxHash);
  const actual = witnessEnvelope(manifest, proof.binding);
  if (proof.manifestTxHash !== proof.claimTxHash) {
    const manifestSource = await source(manifest);
    assertCotaCell(manifestSource, owner);
    const target = output(manifest, proof.manifestTxHash, 0);
    assertCotaCell(target, owner);
    if (manifest.inputs.length !== 1 || manifest.outputs.length !== 1) throw new Error('The final manifest must use the supported single-cell CoTA update.');
    verifyManifestUpdate({ inputType: actual.witness.inputType!, outputType: actual.witness.outputType!,
      previousCotaRoot: cotaRoot(manifestSource), cotaRoot: cotaRoot(target) }, proof.binding);

    // A valid update in another cell must not be substituted for this claim.
    // Intermediate committed operations may update unrelated CoTA leaves, but
    // the unique typed cell must remain under this exact JoyID lock.
    let cursor = manifestSource;
    const seen = new Set<string>();
    for (let depth = 0; ; depth++) {
      if (cursor.outPoint.txHash === proof.claimTxHash) {
        if (cursor.outPoint.index !== 0n) throw new Error('The manifest lineage does not descend from the claimed CoTA output.');
        break;
      }
      if (depth >= maximumLineage) throw new Error('The proof exceeds the CoTA lineage verification limit.');
      const key = `${cursor.outPoint.txHash}:${cursor.outPoint.index}`;
      if (seen.has(key)) throw new Error('The manifest contains a cyclic CoTA lineage.');
      seen.add(key);
      const predecessor = await committed(cursor.outPoint.txHash);
      const matches: ccc.Cell[] = [];
      for (let index = 0; index < predecessor.inputs.length; index++) {
        const candidate = await source(predecessor, index);
        if (candidate.cellOutput.type?.eq(cotaTypeForLock(owner))) matches.push(candidate);
      }
      if (matches.length !== 1) throw new Error('The manifest lineage does not lead to the original claimed CoTA cell.');
      assertCotaCell(matches[0], owner);
      cursor = matches[0];
    }
  }
  if (proof.manifestRoot && proof.manifestRoot !== actual.envelope.manifestRoot) throw new Error('The exported root differs from the confirmed manifest.');

  const anchors = new Map<string, string>();
  for (const envelope of [issued, actual.envelope]) {
    for (const { record } of envelope.records) {
      if (record.kind !== 'backup') continue;
      const anchorOutpoint = String(record.anchorOutpoint);
      const separator = anchorOutpoint.lastIndexOf(':');
      const anchorHash = anchorOutpoint.slice(0, separator);
      const anchorIndex = Number(anchorOutpoint.slice(separator + 1));
      const anchor = await committed(anchorHash);
      const merkleRoot = hex(record.merkleRoot, 32, 'backup Merkle root');
      if (hex(output(anchor, anchorHash, anchorIndex).outputData, 32, 'backup anchor data') !== merkleRoot) throw new Error('A public backup proof differs from its committed CKB anchor.');
      if (anchors.has(anchorOutpoint) && anchors.get(anchorOutpoint) !== merkleRoot) throw new Error('Manifest backup anchors disagree.');
      anchors.set(anchorOutpoint, merkleRoot);
    }
  }
  const developer = actual.envelope.records.find(entry => entry.record.kind === 'developer')!;
  return {
    valid: true as const, protocol: MANIFEST_PROOF_PROTOCOL, network: proof.network,
    githubId: proof.binding.githubId, githubUsername: String(developer.record.githubUsername),
    ownerLockHash: owner.hash(), issuerLockHash: trustedIssuer,
    manifestRoot: actual.envelope.manifestRoot, issuanceTxHash: proof.issuanceTxHash,
    claimTxHash: proof.claimTxHash, manifestTxHash: proof.manifestTxHash,
    backupCount: actual.envelope.records.filter(entry => entry.record.kind === 'backup').length,
    verifiedAnchorCount: anchors.size, fetchedTransactionCount: transactions.size,
    checks: { trustedIssuerAttestation: true, joyIdOwnerApproval: true, coTaManifestRoot: true, backupAnchors: true },
    limitations: [
      'GitHub identity is an attestation by the independently trusted issuer; GitHub account ownership is not checked against GitHub.',
      'Committed status and lock execution are trusted from the selected CKB testnet RPC; block headers are not independently verified.',
      'Backup file bytes, IPFS availability and pinning are not verified.',
      'This verifies a confirmed snapshot; it does not establish the newest CoTA cell state.',
    ],
  };
}
