import { ccc } from '@ckb-ccc/core';
import { isDeepStrictEqual } from 'node:util';
import { buildSmt, commitmentKey, commitmentValue, SmtLeaf } from './cota-smt';

export const MANIFEST_PROTOCOL = 'rivet-cota-manifest-v1';
// Only characteristic updates are allowed. The CoTA receive operation called
// "claim" is separate from the optional NFT claimed-state flag (bit zero).
export const MANIFEST_CONFIGURE = 0xf7;
export const MANIFEST_STATE = 0;
const MAX_BYTES = 200_000;
const UPDATE_ACTION = Buffer.from('Update NFT information');
const ZERO = Buffer.alloc(32);
type PublicRecord = Record<string, string | number>;
export type ManifestRecord = { key: string; record: PublicRecord };
export type ManifestBinding = {
  network: 'ckb-testnet';
  ownerLockHash: string;
  issuerLockHash: string;
  githubId: string;
  collectionId: string;
  indexes: [number, number];
};
export type ManifestEnvelope = ManifestBinding & {
  protocol: typeof MANIFEST_PROTOCOL;
  manifestRoot: string;
  records: ManifestRecord[];
};
export type ManifestBackup = {
  repositoryId: string; repository: string; ipfsCid: string; merkleRoot: string;
  anchorOutpoint: string; commitCount: number;
};

function hex(value: Uint8Array) { return ccc.hexFrom(value); }
function bytes(value: unknown, length?: number): Buffer {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value)
    || value.length > MAX_BYTES * 2 + 2 || (length !== undefined && value.length !== length * 2 + 2)) {
    throw new Error('Invalid manifest hexadecimal data.');
  }
  return Buffer.from(value.slice(2), 'hex');
}
function normalizedHex(value: unknown, length: number) { return hex(bytes(value, length)); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid manifest object.');
  return value as Record<string, unknown>;
}
function exactFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).length !== fields.length || fields.some(field => !(field in value))) throw new Error('Invalid manifest fields.');
}
function textField(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid manifest ${name}.`);
  }
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,29}$/.test(value)) throw new Error('Invalid immutable GitHub ID.');
  return value;
}
function tokenIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Invalid manifest token index.');
  return value;
}
function binding(value: unknown): ManifestBinding {
  const fields = object(value);
  if (fields.network !== 'ckb-testnet') throw new Error('Unsupported manifest network.');
  if (!Array.isArray(fields.indexes) || fields.indexes.length !== 2) throw new Error('A manifest requires exactly two token indexes.');
  const indexes: [number, number] = [tokenIndex(fields.indexes[0]), tokenIndex(fields.indexes[1])];
  if (indexes[0] >= indexes[1]) throw new Error('Manifest token indexes must be distinct and ordered.');
  return { network: 'ckb-testnet', ownerLockHash: normalizedHex(fields.ownerLockHash, 32),
    issuerLockHash: normalizedHex(fields.issuerLockHash, 32), githubId: id(fields.githubId),
    collectionId: normalizedHex(fields.collectionId, 20), indexes };
}

function normalizedRecord(value: unknown, owner: ManifestBinding): PublicRecord {
  const record = object(value);
  if (record.version !== 1 || record.network !== owner.network) throw new Error('Unsupported manifest record encoding.');
  if (record.kind === 'developer') {
    exactFields(record, ['kind', 'version', 'network', 'githubId', 'githubUsername', 'walletLockHash']);
    if (id(record.githubId) !== owner.githubId || normalizedHex(record.walletLockHash, 32) !== owner.ownerLockHash) {
      throw new Error('Manifest identity does not match the verified owner.');
    }
    return { kind: 'developer', version: 1, network: owner.network, githubId: owner.githubId,
      githubUsername: textField(record.githubUsername, 'GitHub username', 100), walletLockHash: owner.ownerLockHash };
  }
  if (record.kind !== 'backup') throw new Error('Invalid manifest record kind.');
  exactFields(record, ['kind', 'version', 'network', 'repository', 'repositoryId', 'ipfsCid', 'merkleRoot', 'anchorOutpoint', 'commitCount']);
  const repository = textField(record.repository, 'repository');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error('Invalid manifest repository.');
  const anchorOutpoint = textField(record.anchorOutpoint, 'anchor outpoint', 80).toLowerCase();
  const outpoint = /^0x[0-9a-f]{64}:(0|[1-9][0-9]*)$/.exec(anchorOutpoint);
  if (!outpoint || !Number.isSafeInteger(Number(outpoint[1])) || Number(outpoint[1]) > 0xffffffff) throw new Error('Invalid manifest anchor outpoint.');
  if (typeof record.commitCount !== 'number' || !Number.isSafeInteger(record.commitCount) || record.commitCount < 0) throw new Error('Invalid manifest commit count.');
  return { kind: 'backup', version: 1, network: owner.network, repository,
    ipfsCid: textField(record.ipfsCid, 'IPFS CID'), merkleRoot: normalizedHex(record.merkleRoot, 32),
    anchorOutpoint, commitCount: record.commitCount, repositoryId: id(record.repositoryId) };
}

/** New manifests use immutable repository IDs. Legacy extension keys remain unchanged. */
export function manifestRecordKey(record: PublicRecord) {
  if (record.kind === 'developer') return commitmentKey('developer');
  if (record.kind === 'backup') return commitmentKey(`backup:github-repository:${id(record.repositoryId)}`);
  throw new Error('Invalid manifest record kind.');
}

function recordsAndTree(entries: unknown, owner: ManifestBinding) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 128) throw new Error('A manifest supports one identity and up to 127 backup records.');
  const records = entries.map(entry => {
    const item = object(entry);
    exactFields(item, ['key', 'record']);
    const record = normalizedRecord(item.record, owner);
    const key = normalizedHex(item.key, 32);
    if (key !== manifestRecordKey(record)) throw new Error('Manifest record key does not match its immutable identity.');
    return { key, record };
  }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  if (records.filter(entry => entry.record.kind === 'developer').length !== 1) throw new Error('A manifest requires exactly one developer identity.');
  const leaves = records.map(entry => ({ key: entry.key, value: commitmentValue(entry.record) }));
  const tree = buildSmt(leaves);
  return { records, leaves: tree.leaves, root: tree.root };
}

export function buildManifest(input: ManifestBinding & { githubUsername: string; backups: ManifestBackup[] }) {
  const owner = binding(input);
  const identity: PublicRecord = { kind: 'developer', version: 1, network: owner.network,
    githubId: owner.githubId, githubUsername: input.githubUsername, walletLockHash: owner.ownerLockHash };
  const records: PublicRecord[] = [identity, ...input.backups.map(backup => ({ kind: 'backup', version: 1, network: owner.network, ...backup }))];
  const result = recordsAndTree(records.map(record => ({ key: manifestRecordKey(record), record })), owner);
  const envelope: ManifestEnvelope = { protocol: MANIFEST_PROTOCOL, ...owner, manifestRoot: result.root, records: result.records };
  return { envelope, root: result.root, leaves: result.leaves, outputType: hex(Buffer.from(JSON.stringify(envelope))),
    characteristics: manifestRootShards(result.root) };
}

/** Full 32-byte roots: 20 bytes in slot zero, 12 bytes plus eight zero bytes in slot one. */
export function manifestRootShards(root: string): [string, string] {
  const raw = bytes(root, 32);
  return [hex(raw.subarray(0, 20)), hex(Buffer.concat([raw.subarray(20), Buffer.alloc(8)]))];
}

export function rootFromManifestShards(characteristics: readonly string[]) {
  if (characteristics.length !== 2) throw new Error('A manifest requires exactly two root shards.');
  const first = bytes(characteristics[0], 20);
  const second = bytes(characteristics[1], 20);
  if (!second.subarray(12).equals(Buffer.alloc(8))) throw new Error('Noncanonical manifest root padding.');
  return hex(Buffer.concat([first, second.subarray(0, 12)]));
}

/** expected must come from an independently authenticated issuance binding. */
export function parseManifestEnvelope(outputType: string, expected: ManifestBinding): ManifestEnvelope {
  const raw = bytes(outputType);
  let value: Record<string, unknown>;
  try { value = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); }
  catch { throw new Error('Invalid manifest envelope.'); }
  exactFields(value, ['protocol', 'network', 'ownerLockHash', 'issuerLockHash', 'githubId', 'collectionId', 'indexes', 'manifestRoot', 'records']);
  if (value.protocol !== MANIFEST_PROTOCOL) throw new Error('Unsupported manifest protocol.');
  const actual = binding(value);
  const trusted = binding(expected);
  if (JSON.stringify(actual) !== JSON.stringify(trusted)) throw new Error('Manifest owner, issuer, GitHub account or tokens differ from the trusted binding.');
  const records = recordsAndTree(value.records, actual);
  if (records.root !== normalizedHex(value.manifestRoot, 32)) throw new Error('Manifest records do not match the declared root.');
  const envelope: ManifestEnvelope = { protocol: MANIFEST_PROTOCOL, ...actual, manifestRoot: records.root, records: records.records };
  if (!raw.equals(Buffer.from(JSON.stringify(envelope)))) throw new Error('Manifest envelope is not canonically encoded.');
  return envelope;
}

/** Restore canonical chain bytes after the enrollment has passed through JSONB. */
export function restoreIssuedManifest(outputType: string, saved: unknown, expected: ManifestBinding) {
  const envelope = parseManifestEnvelope(outputType, expected);
  if (!isDeepStrictEqual(envelope, saved)) throw new Error('The confirmed issuance differs from the saved enrollment manifest.');
  return envelope;
}

function uint32(value: number) { const result = Buffer.alloc(4); result.writeUInt32BE(tokenIndex(value)); return result; }
export function manifestTokenKeys(collectionId: string, indexes: readonly number[]) {
  const collection = bytes(collectionId, 20);
  if (indexes.length !== 2 || tokenIndex(indexes[0]) >= tokenIndex(indexes[1])) throw new Error('Invalid manifest token pair.');
  return indexes.map(index => hex(Buffer.concat([Buffer.from('8101', 'hex'), collection, uint32(index)])));
}
export function manifestHeldLeaves(collectionId: string, indexes: readonly number[], characteristics: readonly string[]): SmtLeaf[] {
  if (characteristics.length !== 2) throw new Error('Invalid manifest root shards.');
  const keys = manifestTokenKeys(collectionId, indexes);
  return keys.map((key, index) => ({ key: `${key}${'00'.repeat(6)}`,
    // CoTA v2 uses ff as the existence marker, including all-zero metadata.
    value: hex(Buffer.concat([Buffer.from([MANIFEST_CONFIGURE, MANIFEST_STATE]), bytes(characteristics[index], 20), Buffer.alloc(9), Buffer.from([255])])) }));
}

export function readMoleculeTable(raw: Buffer, count: number) {
  const header = (count + 1) * 4;
  if (raw.length < header || raw.readUInt32LE(0) !== raw.length || raw.readUInt32LE(4) !== header) throw new Error('Malformed CoTA Molecule table.');
  const offsets = Array.from({ length: count }, (_, index) => raw.readUInt32LE(4 * (index + 1)));
  offsets.push(raw.length);
  if (offsets.some((offset, index) => offset > raw.length || (index > 0 && offset < offsets[index - 1]))) throw new Error('Malformed CoTA Molecule offsets.');
  return offsets.slice(0, count).map((offset, index) => raw.subarray(offset, offsets[index + 1]));
}
export function readFixedVector(raw: Buffer, size: number, requiredCount?: number) {
  if (raw.length < 4) throw new Error('Malformed CoTA Molecule vector.');
  const count = raw.readUInt32LE(0);
  if ((requiredCount !== undefined && count !== requiredCount) || raw.length !== 4 + count * size) throw new Error('Malformed CoTA Molecule vector.');
  return Array.from({ length: count }, (_, index) => raw.subarray(4 + index * size, 4 + (index + 1) * size));
}
export function readMoleculeBytes(raw: Buffer) {
  if (raw.length < 4 || raw.readUInt32LE(0) !== raw.length - 4) throw new Error('Malformed CoTA Molecule byte vector.');
  return raw.subarray(4);
}

export function parseManifestUpdate(inputType: string, expected: ManifestBinding) {
  const raw = bytes(inputType);
  if (raw[0] !== 5) throw new Error('The manifest requires a standard CoTA update operation.');
  const [keyVector, oldVector, newVector, proofVector, actionVector] = readMoleculeTable(raw.subarray(1), 5);
  const keys = readFixedVector(keyVector, 26, 2).map(hex);
  const expectedKeys = manifestTokenKeys(expected.collectionId, expected.indexes);
  if (keys.some((key, index) => key !== expectedKeys[index])) throw new Error('CoTA update changes a different token pair.');
  const oldValues = readFixedVector(oldVector, 22, 2);
  const newValues = readFixedVector(newVector, 22, 2);
  for (const value of [...oldValues, ...newValues]) {
    if (value[0] !== MANIFEST_CONFIGURE || value[1] !== MANIFEST_STATE) throw new Error('Unsafe manifest metadata configuration or state.');
  }
  const proof = readMoleculeBytes(proofVector);
  if (!proof.length) throw new Error('Missing CoTA update proof.');
  const action = readMoleculeBytes(actionVector);
  if (!action.equals(UPDATE_ACTION)) throw new Error('Incorrect standard CoTA update action.');
  const leafValues = (values: Buffer[]) => keys.map((key, index) => ({ key: `${key}${'00'.repeat(6)}`,
    value: hex(Buffer.concat([values[index], Buffer.alloc(9), Buffer.from([255])])) }));
  return { keys, oldValues: oldValues.map(hex), newValues: newValues.map(hex), proof: hex(proof),
    oldLeaves: leafValues(oldValues), newLeaves: leafValues(newValues),
    root: rootFromManifestShards(newValues.map(value => hex(value.subarray(2)))) };
}

type Node = { hash: Buffer } | { base: Buffer; bits: bigint; count: number };
const pathNumber = (raw: Buffer) => BigInt(`0x${Buffer.from(raw).reverse().toString('hex')}`);
const pathBytes = (path: bigint) => Buffer.from(path.toString(16).padStart(64, '0'), 'hex').reverse();
const hash = (...parts: Buffer[]) => bytes(ccc.hashCkb(Buffer.concat(parts)), 32);
const nodeHash = (node: Node): Buffer => 'hash' in node ? node.hash : hash(Buffer.from([2]), node.base, pathBytes(node.bits), Buffer.from([node.count]));
const zero = (node: Node) => 'hash' in node && node.hash.equals(ZERO);
function merge(height: number, path: bigint, left: Node, right: Node): Node {
  if (zero(left) && zero(right)) return { hash: ZERO };
  if (zero(left) || zero(right)) {
    const child = zero(left) ? right : left;
    const bit = zero(left) ? 1n << BigInt(height) : 0n;
    return 'hash' in child ? { base: hash(Buffer.from([height]), pathBytes(path), child.hash), bits: bit, count: 1 }
      : { base: child.base, bits: child.bits | bit, count: (child.count + 1) % 256 };
  }
  return { hash: hash(Buffer.from([1, height]), pathBytes(path), nodeHash(left), nodeHash(right)) };
}

/** Evaluates the compiled CoTA SMT proof VM without reconstructing unknown wallet state. */
export function rootFromCotaProof(leaves: SmtLeaf[], compiledProof: string) {
  if (!leaves.length || leaves.length > 128) throw new Error('Invalid CoTA proof leaf count.');
  const sorted = leaves.map(leaf => ({ path: pathNumber(bytes(leaf.key, 32)), value: bytes(leaf.value, 32) }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (sorted.some((leaf, index) => index > 0 && leaf.path === sorted[index - 1].path)) throw new Error('Duplicate CoTA proof leaf.');
  const proof = bytes(compiledProof);
  const stack: { path: bigint; height: number; node: Node }[] = [];
  let cursor = 0, leafIndex = 0;
  const fail = (): never => { throw new Error('Invalid compiled CoTA SMT proof.'); };
  const take = (count: number) => { if (cursor + count > proof.length) fail(); const value = proof.subarray(cursor, cursor + count); cursor += count; return value; };
  const top = () => { if (!stack.length) fail(); return stack[stack.length - 1]; };
  function sibling(node: Node) {
    const item = top();
    if (item.height > 255) fail();
    const height = item.height;
    const path = (item.path >> BigInt(height + 1)) << BigInt(height + 1);
    item.node = (item.path & (1n << BigInt(height))) !== 0n ? merge(height, path, node, item.node) : merge(height, path, item.node, node);
    item.path = path;
    item.height++;
  }
  while (cursor < proof.length) {
    switch (take(1)[0]) {
      case 0x4c: {
        if (leafIndex >= sorted.length || stack.length >= 32) fail();
        const leaf = sorted[leafIndex++]; stack.push({ path: leaf.path, height: 0, node: { hash: leaf.value } }); break;
      }
      case 0x50: sibling({ hash: take(32) }); break;
      case 0x51: { const raw = take(65); sibling({ count: raw[0], base: raw.subarray(1, 33), bits: pathNumber(raw.subarray(33)) }); break; }
      case 0x48: {
        if (stack.length < 2) fail();
        const right = stack.pop()!, left = stack.pop()!;
        const height = left.height;
        if (height !== right.height || height > 255) fail();
        const path = (left.path >> BigInt(height + 1)) << BigInt(height + 1);
        if (path !== (right.path >> BigInt(height + 1)) << BigInt(height + 1)
          || ((left.path ^ right.path) & (1n << BigInt(height))) === 0n) fail();
        const node = (left.path & (1n << BigInt(height))) !== 0n ? merge(height, path, right.node, left.node) : merge(height, path, left.node, right.node);
        stack.push({ path, height: height + 1, node }); break;
      }
      case 0x4f: { const count = take(1)[0] || 256; for (let index = 0; index < count; index++) sibling({ hash: ZERO }); break; }
      default: fail();
    }
  }
  if (stack.length !== 1 || stack[0].height !== 256 || leafIndex !== sorted.length) fail();
  return hex(nodeHash(stack[0].node));
}

export function verifyManifestUpdate(input: { inputType: string; outputType: string; previousCotaRoot: string; cotaRoot: string }, expected: ManifestBinding) {
  const envelope = parseManifestEnvelope(input.outputType, expected);
  const update = parseManifestUpdate(input.inputType, expected);
  if (update.root !== envelope.manifestRoot) throw new Error('CoTA metadata shards do not match the manifest root.');
  if (rootFromCotaProof(update.oldLeaves, update.proof) !== normalizedHex(input.previousCotaRoot, 32)
    || rootFromCotaProof(update.newLeaves, update.proof) !== normalizedHex(input.cotaRoot, 32)) {
    throw new Error('CoTA proof does not match the input and output roots.');
  }
  return { envelope, ...update };
}
