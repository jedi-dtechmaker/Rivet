import { ccc } from '@ckb-ccc/core';
import { CkbHttpTransport, createTestnetClient } from './ckb-server';
import { COTA_TESTNET, cotaTypeForLock } from './cota';
import { EMPTY_ROOT, SmtLeaf } from './cota-smt';
import { ManifestBinding, ManifestEnvelope, MANIFEST_CONFIGURE, manifestHeldLeaves, manifestRootShards,
  manifestTokenKeys, readMoleculeTable, readFixedVector, readMoleculeBytes, rootFromCotaProof,
  parseManifestEnvelope, verifyManifestUpdate } from './cota-manifest';

const MAX_FEE = ccc.fixedPointFrom('0.01');
const hex = (value: Uint8Array) => ccc.hexFrom(value);
const bytes = (value: string) => Buffer.from(value.slice(2), 'hex');
export function chainHex(value: unknown, length?: number): ccc.Hex {
  if (typeof value !== 'string') throw new Error('The CoTA proof service returned invalid hexadecimal data.');
  const normalized = `0x${value.replace(/^0x/, '').toLowerCase()}`;
  if (!/^0x(?:[a-f0-9]{2})+$/.test(normalized) || normalized.length > 400002 || (length !== undefined && normalized.length !== 2 + length * 2)) {
    throw new Error('The CoTA proof service returned invalid hexadecimal data.');
  }
  return normalized as ccc.Hex;
}
export const outpoint = (cell: ccc.Cell) => `${cell.outPoint.txHash}:${cell.outPoint.index}`;
export function cotaRoot(cell: ccc.Cell) {
  if (!/^0x02[0-9a-f]{64}$/i.test(cell.outputData)) throw new Error('The CoTA cell has an unsupported data format.');
  return `0x${cell.outputData.slice(4)}`.toLowerCase();
}
export function uint32be(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('The CoTA token index is invalid.');
  const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return hex(buffer);
}

export async function cotaProofRpc<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
  const family = process.env.CKB_RPC_IP_FAMILY;
  const transport = new CkbHttpTransport(process.env.COTA_AGGREGATOR_URL || 'https://cota.nervina.dev/aggregator', 30000,
    family === '4' ? 4 : family === '6' ? 6 : undefined);
  const response = await transport.request({ jsonrpc: '2.0', id: 1, method, params });
  const body = response as unknown as { result?: T; error?: { code?: number } };
  if (body.error || !body.result) throw new Error(`The CoTA proof service is not ready for ${method}. Retry after its indexer catches up.`);
  return body.result;
}

export async function confirmedCotaCell(lock: ccc.Script, client: ccc.Client = createTestnetClient()) {
  const cell = await client.findSingletonCellByType(cotaTypeForLock(lock));
  if (!cell || !cell.cellOutput.lock.eq(lock)) throw new Error('The expected user-owned CoTA cell was not found.');
  cotaRoot(cell);
  if ((await client.getTransaction(cell.outPoint.txHash))?.status !== 'committed') throw new Error('The CoTA cell is awaiting confirmation.');
  return cell;
}

export function createStandardCotaTransaction(cell: ccc.Cell, root: string, inputType: string, outputType?: string) {
  const transaction = ccc.Transaction.from({
    inputs: [{ previousOutput: cell.outPoint, cellOutput: cell.cellOutput.clone(), outputData: cell.outputData }],
    outputs: [cell.cellOutput.clone()], outputsData: [`0x02${chainHex(root, 32).slice(2)}`],
    cellDeps: [COTA_TESTNET.cellDeps[0]],
  });
  transaction.setWitnessArgs(0, { inputType: chainHex(inputType), ...(outputType ? { outputType } : {}) });
  return transaction;
}

export async function finishStandardTransaction(transaction: ccc.Transaction, owner: 'joyid' | 'secp', client: ccc.Client = createTestnetClient()) {
  await transaction.addCellDepsOfKnownScripts(client, owner === 'joyid' ? ccc.KnownScript.JoyId : ccc.KnownScript.Secp256k1Blake160);
  const fee = BigInt(transaction.toBytes().length + (owner === 'joyid' ? 12000 : 1000));
  if (fee > MAX_FEE) throw new Error('The manifest transaction exceeds the fee limit.');
  transaction.outputs[0].capacity -= fee;
  const minimum = ccc.fixedPointFrom(transaction.outputs[0].occupiedSize + ccc.bytesFrom(transaction.outputsData[0]).length);
  if (transaction.outputs[0].capacity < minimum) throw new Error('The CoTA cell needs more capacity before publishing another manifest.');
  return transaction;
}

function verifyTransition(cell: ccc.Cell, root: string, oldLeaves: SmtLeaf[], newLeaves: SmtLeaf[], proof: Buffer) {
  if (rootFromCotaProof(oldLeaves, hex(proof)) !== cotaRoot(cell)
    || rootFromCotaProof(newLeaves, hex(proof)) !== chainHex(root, 32)) throw new Error('The CoTA proof does not preserve the actual cell state.');
}
function heldInfos(values: Buffer[], binding: ManifestBinding, root: string) {
  if (values.length !== 2) throw new Error('The CoTA claim must contain the designated metadata pair.');
  const shards = manifestRootShards(root);
  values.forEach((value, index) => {
    if (!value.equals(Buffer.concat([Buffer.from([MANIFEST_CONFIGURE, 0]), bytes(shards[index])]))) throw new Error('The CoTA metadata pair differs from the approved manifest.');
  });
  return manifestHeldLeaves(binding.collectionId, binding.indexes, shards);
}

function u32(value: number) { return bytes(uint32be(value)); }
function paddedValue(value: Buffer) { return hex(Buffer.concat([value, Buffer.alloc(31 - value.length), Buffer.from([255])])); }
function fixedKeys(raw: Buffer, size: number, expected: Buffer[]) {
  const keys = readFixedVector(raw, size, expected.length);
  if (keys.some((key, index) => !key.equals(expected[index]))) throw new Error('The CoTA witness contains different metadata identifiers.');
  return keys;
}
function assertCell(cell: ccc.Cell, transaction: ccc.Transaction) {
  if (transaction.inputs.length !== 1 || transaction.outputs.length !== 1 || transaction.outputsData.length !== 1
    || !transaction.inputs[0].previousOutput.eq(cell.outPoint) || transaction.inputs[0].since !== 0n
    || !cell.cellOutput.type?.eq(cotaTypeForLock(cell.cellOutput.lock))
    || !transaction.outputs[0].lock.eq(cell.cellOutput.lock) || !transaction.outputs[0].type?.eq(cell.cellOutput.type)) {
    throw new Error('The CoTA transaction changes the source cell or owner.');
  }
}
function transactionRoot(transaction: ccc.Transaction) {
  if (!/^0x02[0-9a-f]{64}$/i.test(transaction.outputsData[0])) throw new Error('The CoTA transaction contains an invalid root.');
  return `0x${transaction.outputsData[0].slice(4)}`;
}
function defineKey(collection: string) { return Buffer.concat([Buffer.from('8100', 'hex'), bytes(chainHex(collection, 20))]); }
function defineValue(issued: number) { return Buffer.concat([u32(0), u32(issued), Buffer.from([MANIFEST_CONFIGURE])]); }
function readDynamicVector(raw: Buffer, requiredCount: number) {
  // A Molecule dynvec has the same offsets layout as a table.
  return readMoleculeTable(raw, requiredCount);
}
function withdrawalKey(collectionId: string, index: number, sourceSlice: Buffer) {
  return Buffer.concat([Buffer.from('8102', 'hex'), bytes(collectionId), u32(index), sourceSlice]);
}

export function deriveManifestCollectionId(cell: ccc.Cell) {
  const firstInput = ccc.CellInput.from({ previousOutput: cell.outPoint, since: 0 });
  return ccc.hashCkb(Buffer.concat([Buffer.from(firstInput.toBytes()), Buffer.from([0])])).slice(0, 42);
}

export function verifyManifestDefine(cell: ccc.Cell, transaction: ccc.Transaction) {
  assertCell(cell, transaction);
  const collectionId = deriveManifestCollectionId(cell);
  const witness = transaction.getWitnessArgs(0);
  const raw = bytes(chainHex(witness?.inputType));
  if (raw[0] !== 1) throw new Error('The collection requires a standard CoTA define operation.');
  const fields = readMoleculeTable(raw.subarray(1), 4);
  const keys = fixedKeys(fields[0], 22, [defineKey(collectionId)]);
  const values = readFixedVector(fields[1], 9, 1);
  if (!values[0].equals(defineValue(0))) throw new Error('The metadata collection has an unsafe definition.');
  if (readMoleculeBytes(fields[3]).toString() !== 'Create a new NFT collection with unlimited edition') throw new Error('Unexpected CoTA define action.');
  const leaves = [{ key: hex(Buffer.concat([keys[0], Buffer.alloc(10)])), value: paddedValue(values[0]) }];
  const proof = readMoleculeBytes(fields[2]);
  verifyTransition(cell, transactionRoot(transaction), leaves.map(leaf => ({ ...leaf, value: EMPTY_ROOT })), leaves, proof);
  return { collectionId, leaves, proof: hex(proof) };
}

export async function prepareManifestDefine(cell: ccc.Cell, client: ccc.Client = createTestnetClient(), rpc = cotaProofRpc) {
  const collectionId = deriveManifestCollectionId(cell);
  const reply = await rpc<{ smt_root_hash: string; define_smt_entry: string }>('generate_define_cota_smt', {
    lock_script: hex(cell.cellOutput.lock.toBytes()), cota_id: collectionId, total: uint32be(0), issued: uint32be(0), configure: '0xf7',
  });
  const transaction = createStandardCotaTransaction(cell, reply.smt_root_hash, `0x01${chainHex(reply.define_smt_entry).slice(2)}`);
  verifyManifestDefine(cell, transaction);
  await finishStandardTransaction(transaction, 'secp', client);
  return { transaction, collectionId };
}

export function verifyManifestMint(cell: ccc.Cell, owner: ccc.Script, envelope: ManifestEnvelope, issuance: ccc.Transaction) {
  assertCell(cell, issuance);
  if (owner.hash() !== envelope.ownerLockHash || cell.cellOutput.lock.hash() !== envelope.issuerLockHash) throw new Error('The manifest issuance owner or issuer differs from its trusted binding.');
  parseManifestEnvelope(issuance.getWitnessArgs(0)?.outputType || '', envelope);
  const inputType = bytes(chainHex(issuance.getWitnessArgs(0)?.inputType));
  if (inputType[0] !== 2) throw new Error('The metadata requires a standard CoTA mint operation.');
  const fields = readMoleculeTable(inputType.subarray(1), 7);
  const keys = fixedKeys(fields[0], 22, [defineKey(envelope.collectionId)]);
  const oldInfo = readFixedVector(fields[1], 9, 1)[0];
  const newInfo = readFixedVector(fields[2], 9, 1)[0];
  if (envelope.indexes[1] !== envelope.indexes[0] + 1 || envelope.indexes[1] === 0xffffffff
    || !oldInfo.equals(defineValue(envelope.indexes[0])) || !newInfo.equals(defineValue(envelope.indexes[1] + 1))) {
    throw new Error('The metadata mint does not match the reserved collection indexes or policy.');
  }
  const sourceSlice = Buffer.from(cell.outPoint.toBytes()).subarray(12);
  const withdrawalKeys = fixedKeys(fields[3], 50, envelope.indexes.map(index => withdrawalKey(envelope.collectionId, index, sourceSlice)));
  const values = readDynamicVector(fields[4], 2);
  const shards = manifestRootShards(envelope.manifestRoot);
  values.forEach((value, index) => {
    const parts = readMoleculeTable(value, 2);
    if (!parts[0].equals(Buffer.concat([Buffer.from([MANIFEST_CONFIGURE, 0]), bytes(shards[index])]))
      || !readMoleculeBytes(parts[1]).equals(Buffer.from(owner.toBytes()))) throw new Error('The metadata mint targets a different wallet or manifest.');
  });
  // The official aggregator emits no action for a batch mint.
  if (readMoleculeBytes(fields[6]).length !== 0) throw new Error('Unexpected CoTA batch mint action.');
  const definitionKey = hex(Buffer.concat([keys[0], Buffer.alloc(10)]));
  const withdrawalLeaves = withdrawalKeys.map((key, index) => ({ key: ccc.hashCkb(key), value: ccc.hashCkb(values[index]) }));
  const oldLeaves = [{ key: definitionKey, value: paddedValue(oldInfo) }, ...withdrawalLeaves.map(leaf => ({ ...leaf, value: EMPTY_ROOT }))];
  const newLeaves = [{ key: definitionKey, value: paddedValue(newInfo) }, ...withdrawalLeaves];
  const proof = readMoleculeBytes(fields[5]);
  verifyTransition(cell, transactionRoot(issuance), oldLeaves, newLeaves, proof);
  return { withdrawalLeaves, oldLeaves, newLeaves, proof: hex(proof) };
}

export async function prepareManifestMint(cell: ccc.Cell, owner: ccc.Script, envelope: ManifestEnvelope, outputType: string,
  client: ccc.Client = createTestnetClient(), rpc = cotaProofRpc) {
  parseManifestEnvelope(outputType, envelope);
  const defined = await rpc<{ total: number; issued: number; configure: string }>('get_define_info', { cota_id: envelope.collectionId });
  if (defined.total !== 0 || chainHex(defined.configure, 1) !== '0xf7' || defined.issued !== envelope.indexes[0]
    || envelope.indexes[1] !== defined.issued + 1) throw new Error('The metadata collection indexes changed. Reconcile the saved issuance before trying again.');
  const reply = await rpc<{ smt_root_hash: string; mint_smt_entry: string }>('generate_mint_cota_smt', {
    lock_script: hex(cell.cellOutput.lock.toBytes()), cota_id: envelope.collectionId,
    out_point: hex(Buffer.from(cell.outPoint.toBytes()).subarray(12)),
    withdrawals: envelope.indexes.map((index, part) => ({ token_index: uint32be(index), state: '0x00',
      characteristic: manifestRootShards(envelope.manifestRoot)[part], to_lock_script: hex(owner.toBytes()) })),
  });
  const transaction = createStandardCotaTransaction(cell, reply.smt_root_hash, `0x02${chainHex(reply.mint_smt_entry).slice(2)}`, outputType);
  verifyManifestMint(cell, owner, envelope, transaction);
  return finishStandardTransaction(transaction, 'secp', client);
}

export async function prepareManifestUpdate(cell: ccc.Cell, envelope: ManifestEnvelope, outputType: string, client: ccc.Client = createTestnetClient(), rpc = cotaProofRpc) {
  if (cell.cellOutput.lock.hash() !== envelope.ownerLockHash) throw new Error('The CoTA update belongs to a different wallet.');
  const reply = await rpc<{ smt_root_hash: string; update_smt_entry: string }>('generate_update_cota_smt', {
    lock_script: hex(cell.cellOutput.lock.toBytes()), nfts: envelope.indexes.map((index, part) => ({
      cota_id: envelope.collectionId, token_index: uint32be(index), state: '0x00', characteristic: manifestRootShards(envelope.manifestRoot)[part],
    })),
  });
  const root = chainHex(reply.smt_root_hash, 32), inputType = `0x05${chainHex(reply.update_smt_entry).slice(2)}`;
  verifyManifestUpdate({ inputType, outputType, previousCotaRoot: cotaRoot(cell), cotaRoot: root }, envelope);
  const transaction = createStandardCotaTransaction(cell, root, inputType, outputType);
  assertCell(cell, transaction);
  return finishStandardTransaction(transaction, 'joyid', client);
}

export function verifyManifestClaim(cell: ccc.Cell, issuer: ccc.Script, envelope: ManifestEnvelope, issuance: ccc.Transaction, transaction: ccc.Transaction) {
  assertCell(cell, transaction);
  if (cell.cellOutput.lock.hash() !== envelope.ownerLockHash || issuer.hash() !== envelope.issuerLockHash) throw new Error('The CoTA claim owner or issuer differs from the trusted binding.');
  const outputType = transaction.getWitnessArgs(0)?.outputType || '';
  parseManifestEnvelope(outputType, envelope);
  if (issuance.getWitnessArgs(0)?.outputType !== outputType || !issuance.outputs[0]?.lock.eq(issuer)
    || !issuance.outputs[0]?.type?.eq(cotaTypeForLock(issuer))) throw new Error('The CoTA claim does not match the approved issuance binding.');
  const inputType = bytes(chainHex(transaction.getWitnessArgs(0)?.inputType));
  if (inputType[0] !== 4) throw new Error('The metadata requires a standard CoTA claim operation.');
  const fields = readMoleculeTable(inputType.subarray(1), 12);
  const keys = readFixedVector(fields[0], 26, 2).map(hex);
  if (keys.some((key, index) => key !== manifestTokenKeys(envelope.collectionId, envelope.indexes)[index])) throw new Error('The CoTA claim contains different metadata tokens.');
  const held = heldInfos(readFixedVector(fields[1], 22, 2), envelope, envelope.manifestRoot);
  const claimKeys = readFixedVector(fields[2], 50, 2);
  const claimValues = readFixedVector(fields[3], 32, 2);
  const sourceSlice = Buffer.from(issuance.inputs[0].previousOutput.toBytes()).subarray(12);
  claimKeys.forEach((key, index) => {
    if (!key.subarray(0, 2).equals(Buffer.from('8103', 'hex')) || !key.subarray(2, 26).equals(bytes(keys[index]).subarray(2))
      || !key.subarray(26).equals(sourceSlice) || !claimValues[index].equals(Buffer.concat([Buffer.from([1]), Buffer.alloc(31, 255)]))) {
      throw new Error('The CoTA claim receipt does not match the confirmed issuance.');
    }
  });
  // Version is encoded in the witness receipt, but the stored SMT value is ff32.
  const receipts = claimKeys.map(key => ({ key: ccc.hashCkb(key), value: `0x${'ff'.repeat(32)}` }));
  const nextLeaves = [...held, ...receipts];
  verifyTransition(cell, transactionRoot(transaction), nextLeaves.map(leaf => ({ ...leaf, value: EMPTY_ROOT })), nextLeaves, readMoleculeBytes(fields[4]));
  if (readMoleculeBytes(fields[5]).toString() !== 'Claim 2 NFTs') throw new Error('Unexpected CoTA claim action.');
  if (!readMoleculeBytes(fields[9]).equals(Buffer.from(ccc.RawTransaction.encode(issuance))) || fields[10].length !== 4 || fields[10].readUInt32BE(0) !== 0) {
    throw new Error('The CoTA claim does not reference the confirmed issuer transaction.');
  }
  // Current V2 witnesses carry an extracted withdrawal proof with no auxiliary
  // leaves. Validate it against the exact confirmed issuer root as well.
  readFixedVector(fields[6], 32, 0); readFixedVector(fields[7], 32, 0);
  const mintRaw = bytes(chainHex(issuance.getWitnessArgs(0)?.inputType));
  if (mintRaw[0] !== 2) throw new Error('The claimed records were not issued by a standard mint.');
  const mintFields = readMoleculeTable(mintRaw.subarray(1), 7);
  const mintedKeys = readFixedVector(mintFields[3], 50, 2);
  const mintedValues = readDynamicVector(mintFields[4], 2);
  fixedKeys(mintFields[3], 50, envelope.indexes.map(index => withdrawalKey(envelope.collectionId, index, sourceSlice)));
  const shards = manifestRootShards(envelope.manifestRoot);
  mintedValues.forEach((value, index) => {
    const parts = readMoleculeTable(value, 2);
    if (!parts[0].equals(Buffer.concat([Buffer.from([MANIFEST_CONFIGURE, 0]), bytes(shards[index])]))
      || !readMoleculeBytes(parts[1]).equals(Buffer.from(cell.cellOutput.lock.toBytes()))) throw new Error('The issuance targets a different wallet or manifest.');
  });
  const withdrawalLeaves = mintedKeys.map((key, index) => ({ key: ccc.hashCkb(key), value: ccc.hashCkb(mintedValues[index]) }));
  if (rootFromCotaProof(withdrawalLeaves, hex(readMoleculeBytes(fields[8]))) !== transactionRoot(issuance)) throw new Error('The CoTA claim withdrawal proof differs from the confirmed issuance.');
  // The contract checks this transaction-in-block proof. Parse all boundaries
  // here; dry-run and committed-chain verification establish its header binding.
  const txProof = readMoleculeTable(fields[11], 2);
  if (txProof[0].length !== 32) throw new Error('Invalid CoTA transaction proof.');
  const merkleProof = readMoleculeTable(txProof[1], 2);
  readFixedVector(merkleProof[0], 4, 1); readFixedVector(merkleProof[1], 32);
  return { heldLeaves: held, receiptLeaves: receipts, withdrawalLeaves, proof: hex(readMoleculeBytes(fields[4])) };
}

export async function prepareManifestClaim(cell: ccc.Cell, issuer: ccc.Script, envelope: ManifestEnvelope, outputType: string,
  issuance: ccc.Transaction, client: ccc.Client = createTestnetClient(), rpc = cotaProofRpc) {
  parseManifestEnvelope(outputType, envelope);
  const confirmed = await client.getTransaction(issuance.hash());
  if (confirmed?.status !== 'committed' || !confirmed.blockHash || confirmed.transaction.getWitnessArgs(0)?.outputType !== outputType) {
    throw new Error('The metadata issuance and its authenticated binding must be confirmed before claiming.');
  }
  const reply = await rpc<{ smt_root_hash: string; claim_smt_entry: string; withdraw_block_hash: string }>('generate_claim_cota_smt', {
    lock_script: hex(cell.cellOutput.lock.toBytes()), withdrawal_lock_script: hex(issuer.toBytes()),
    claims: envelope.indexes.map(index => ({ cota_id: envelope.collectionId, token_index: uint32be(index) })),
  });
  if (chainHex(reply.withdraw_block_hash, 32) !== confirmed.blockHash) throw new Error('The CoTA claim references a different issuance block.');
  const entry = chainHex(reply.claim_smt_entry), root = chainHex(reply.smt_root_hash, 32);
  const transaction = createStandardCotaTransaction(cell, root, `0x04${entry.slice(2)}`, outputType);
  transaction.headerDeps.push(chainHex(reply.withdraw_block_hash, 32));
  verifyManifestClaim(cell, issuer, envelope, confirmed.transaction, transaction);
  return finishStandardTransaction(transaction, 'joyid', client);
}

export function validateManifestSigned(unsigned: ccc.Transaction, signed: ccc.Transaction) {
  if (unsigned.hash() !== signed.hash() || signed.witnesses.length !== unsigned.witnesses.length) throw new Error('The approved transaction differs from the prepared manifest.');
  const expected = unsigned.getWitnessArgs(0), actual = signed.getWitnessArgs(0);
  if (!actual?.lock || actual.lock === '0x' || expected?.inputType !== actual.inputType || expected?.outputType !== actual.outputType
    || signed.witnesses.some((witness, index) => index > 0 && witness !== unsigned.witnesses[index])) {
    throw new Error('The approved transaction differs from the prepared manifest.');
  }
  const fee = unsigned.inputs[0].cellOutput!.capacity - signed.outputs[0].capacity;
  if (fee < BigInt(signed.toBytes().length) || fee > MAX_FEE) throw new Error('The manifest transaction exceeds the fee limit.');
}
