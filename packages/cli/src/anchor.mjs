import { createHash } from 'node:crypto';

const MAGIC = Buffer.from('52565402', 'hex'); // RVT + version 2
const DIGEST = /^0x[a-f0-9]{64}$/i;
export const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/;

/** @typedef {{version: 1, merkleRoot: string} | {version: 2, merkleRoot: string, refsHash: string, bundleSha256: string, commitCount: number, ipfsCid: string}} BackupAnchor */
/** @param {Uint8Array | string} bytes */
export const sha256 = bytes => `0x${createHash('sha256').update(bytes).digest('hex')}`;

/** Hash UTF-8 "refname SP object-id LF" rows, sorted by refname bytes. */
export function refsCommitment(/** @type {string[]} */ refs) {
  const names = new Set();
  const rows = refs.map(row => {
    const match = /^(refs\/[^\s\0]+) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(row);
    if (!match || names.has(match[1])) throw new Error('Invalid or duplicate bundle ref.');
    names.add(match[1]);
    return row;
  }).sort((a, b) => Buffer.compare(Buffer.from(a.split(' ')[0]), Buffer.from(b.split(' ')[0])));
  if (!rows.length) throw new Error('Bundle has no refs.');
  return sha256(rows.join('\n') + '\n');
}

/** @param {Omit<Extract<BackupAnchor, {version: 2}>, 'version'>} anchor */
export function encodeBackupAnchor(anchor) {
  if (![anchor.merkleRoot, anchor.refsHash, anchor.bundleSha256].every(value => DIGEST.test(value))
    || !Number.isSafeInteger(anchor.commitCount) || anchor.commitCount < 1 || anchor.commitCount > 0xffffffff
    || !CID_PATTERN.test(anchor.ipfsCid)) throw new Error('Invalid version 2 backup anchor.');
  const count = Buffer.alloc(4);
  count.writeUInt32BE(anchor.commitCount);
  const cid = Buffer.from(anchor.ipfsCid, 'ascii');
  return `0x${Buffer.concat([MAGIC, ...[anchor.merkleRoot, anchor.refsHash, anchor.bundleSha256].map(value => Buffer.from(value.slice(2), 'hex')),
    count, Buffer.from([cid.length]), cid]).toString('hex')}`;
}

/** Strictly decode legacy roots or a complete v2 payload; never guess a version. @returns {BackupAnchor} */
export function parseBackupAnchor(/** @type {string} */ data) {
  if (typeof data !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(data)) throw new Error('Invalid backup anchor data.');
  if (DIGEST.test(data)) return { version: 1, merkleRoot: data.toLowerCase() };
  const bytes = Buffer.from(data.slice(2), 'hex');
  if (bytes.length < 105 || !bytes.subarray(0, 4).equals(MAGIC) || bytes.length !== 105 + bytes[104]) throw new Error('Unsupported backup anchor format.');
  const anchor = { version: /** @type {const} */ (2), merkleRoot: `0x${bytes.subarray(4, 36).toString('hex')}`,
    refsHash: `0x${bytes.subarray(36, 68).toString('hex')}`, bundleSha256: `0x${bytes.subarray(68, 100).toString('hex')}`,
    commitCount: bytes.readUInt32BE(100), ipfsCid: bytes.subarray(105).toString('utf8') };
  if (!anchor.commitCount || !CID_PATTERN.test(anchor.ipfsCid)) throw new Error('Invalid version 2 backup anchor.');
  return anchor;
}

/** @param {string} data @param {{merkleRoot?: string, ipfsCid?: string, commitCount?: number}} expected */
export function checkBackupAnchor(data, expected) {
  const anchor = parseBackupAnchor(data);
  if ((expected.merkleRoot !== undefined && anchor.merkleRoot !== expected.merkleRoot.toLowerCase())
    || (anchor.version === 2 && ((expected.ipfsCid !== undefined && anchor.ipfsCid !== expected.ipfsCid)
      || (expected.commitCount !== undefined && anchor.commitCount !== expected.commitCount)))) {
    throw new Error('Backup differs from its committed CKB anchor.');
  }
  return anchor;
}
