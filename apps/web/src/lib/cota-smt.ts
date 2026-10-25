import { ccc } from '@ckb-ccc/core';

export const EMPTY_ROOT = `0x${'00'.repeat(32)}`;
const SUBTYPE = Buffer.from('rivet1');
const PREFIX = `ff00${SUBTYPE.toString('hex')}`;
export type SmtLeaf = { key: string; value: string };
type Node = { hash: string } | { base: string; bits: bigint; count: number };

function hash(...parts: Buffer[]) {
  return ccc.hashCkb(Buffer.concat(parts));
}

function bytes(value: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid SMT key or value.');
  return Buffer.from(value.slice(2), 'hex');
}

function numberKey(value: string) {
  return BigInt(`0x${Buffer.from(bytes(value)).reverse().toString('hex')}`);
}

function keyBytes(value: bigint) {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex').reverse();
}

function nodeHash(node: Node): string {
  return 'hash' in node ? node.hash : hash(Buffer.from([2]), bytes(node.base), keyBytes(node.bits), Buffer.from([node.count]));
}

function merge(height: number, path: bigint, left: Node, right: Node): Node {
  const leftZero = 'hash' in left && left.hash === EMPTY_ROOT;
  const rightZero = 'hash' in right && right.hash === EMPTY_ROOT;
  if (leftZero && rightZero) return { hash: EMPTY_ROOT };
  if (leftZero || rightZero) {
    const child = leftZero ? right : left;
    const bit = leftZero ? 1n << BigInt(height) : 0n;
    return 'hash' in child
      ? { base: hash(Buffer.from([height]), keyBytes(path), bytes(child.hash)), bits: bit, count: 1 }
      : { base: child.base, bits: child.bits | bit, count: (child.count + 1) % 256 };
  }
  return { hash: hash(Buffer.from([1, height]), keyBytes(path), bytes(nodeHash(left)), bytes(nodeHash(right))) };
}

export function buildSmt(leaves: SmtLeaf[]) {
  if (leaves.length > 128) throw new Error('This identity supports up to 127 backup records per sync.');
  const sorted = leaves.map(leaf => ({ ...leaf, path: numberKey(leaf.key) })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  sorted.forEach((leaf, index) => {
    bytes(leaf.value);
    if (index && leaf.path === sorted[index - 1].path) throw new Error('Duplicate SMT key.');
  });
  const proof: number[] = [];
  function walk(items: typeof sorted, height: number, path: bigint): Node {
    if (items.length === 0) return { hash: EMPTY_ROOT };
    if (height < 0) { proof.push(0x4c); return { hash: items[0].value.toLowerCase() }; }
    const mask = 1n << BigInt(height);
    const split = items.findIndex(item => (item.path & mask) !== 0n);
    const leftItems = split < 0 ? items : items.slice(0, split);
    const rightItems = split < 0 ? [] : items.slice(split);
    const left = walk(leftItems, height - 1, path);
    const right = walk(rightItems, height - 1, path | mask);
    if (leftItems.length && rightItems.length) proof.push(0x48);
    else proof.push(0x4f, 1);
    return merge(height, path, left, right);
  }
  const root = nodeHash(walk(sorted, 255, 0n));
  return { root, proof: Buffer.from(proof), leaves: sorted.map(({ key, value }) => ({ key, value })) };
}

function uint32(value: number) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}

function table(fields: Buffer[]) {
  let offset = 4 * (fields.length + 1);
  const offsets = fields.map(field => { const current = offset; offset += field.length; return uint32(current); });
  return Buffer.concat([uint32(offset), ...offsets, ...fields]);
}

function vector(values: string[]) {
  return Buffer.concat([uint32(values.length), ...values.map(bytes)]);
}

export function commitmentKey(name: string) {
  return `0x${PREFIX}${hash(Buffer.from(name)).slice(2, 50)}`;
}

export function commitmentValue(record: unknown) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid identity record.');
  const fields = record as Record<string, unknown>;
  const order = fields.kind === 'developer'
    ? ['kind', 'version', 'network', 'githubId', 'githubUsername', 'walletLockHash']
    : fields.kind === 'backup'
      ? ['kind', 'version', 'network', 'repository', 'ipfsCid', 'merkleRoot', 'anchorOutpoint', 'commitCount'] : [];
  const keys = [...order.filter(key => key in fields), ...Object.keys(fields).filter(key => !order.includes(key)).sort()];
  if (keys.some(key => !['string', 'number'].includes(typeof fields[key]))) throw new Error('Invalid identity record.');
  return hash(Buffer.from(JSON.stringify(Object.fromEntries(keys.map(key => [key, fields[key]])))));
}

export function extensionUpdate(previous: SmtLeaf[], next: SmtLeaf[], records: unknown) {
  const old = new Map(previous.map(leaf => [leaf.key, leaf.value]));
  if (previous.some(leaf => !next.some(candidate => candidate.key === leaf.key))) throw new Error('Removing existing identity records is not supported.');
  if (next.some(leaf => !leaf.key.startsWith(`0x${PREFIX}`) || leaf.value === EMPTY_ROOT)) throw new Error('Invalid Rivet extension leaf.');
  const tree = buildSmt(next);
  const oldTree = buildSmt(tree.leaves.map(leaf => ({ key: leaf.key, value: old.get(leaf.key) || EMPTY_ROOT })));
  const leaves = table([
    vector(tree.leaves.map(leaf => leaf.key)), vector(tree.leaves.map(leaf => leaf.value)),
    vector(tree.leaves.map(leaf => old.get(leaf.key) || EMPTY_ROOT)),
    Buffer.concat([uint32(tree.proof.length), tree.proof]),
  ]);
  const raw = Buffer.from(JSON.stringify(records));
  const entry = table([leaves, SUBTYPE, Buffer.concat([uint32(raw.length), raw])]);
  return { root: tree.root, previousRoot: oldTree.root, leaves: tree.leaves, witness: `0xf1${entry.toString('hex')}` };
}
