import { createHash, createDecipheriv } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, mkdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CID_PATTERN, checkBackupAnchor, encodeBackupAnchor, refsCommitment, sha256 } from './anchor.mjs';
import { retryRead, responseError } from './retry.mjs';
const exec = promisify(execFile);
export const git = (args, cwd) => exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
const hash = bytes => createHash('sha256').update(bytes).digest();
export function commitRoot(commits) {
  if (!commits.length || commits.some(id => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id))) throw new Error('Invalid commit list.');
  let nodes = commits.map(id => hash(id));
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) next.push(nodes[i + 1] ? hash(Buffer.concat([nodes[i], nodes[i + 1]])) : nodes[i]);
    nodes = next;
  }
  return `0x${nodes[0].toString('hex')}`;
}
export function parseProof(proof) {
  if (!['rivet-backup-proof-v1', 'rivet-backup-proof-v2'].includes(proof?.protocol) || proof.network !== 'ckb-testnet'
    || !/^0x[a-f0-9]{64}$/i.test(proof.txHash || '') || !/^0x[a-f0-9]{64}$/i.test(proof.merkleRoot || '')
    || !Number.isSafeInteger(proof.outputIndex) || proof.outputIndex < 0
    || !Number.isSafeInteger(proof.commitCount) || proof.commitCount < 1
    || !CID_PATTERN.test(proof.ipfsCid || '')) throw new Error('Invalid testnet backup proof.');
  if (proof.protocol === 'rivet-backup-proof-v2') encodeBackupAnchor(proof);
  return proof;
}
export async function rpc(url, method, params, request = fetch) {
  const endpoint = new URL(url);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid RPC URL.');
  if (!['get_transaction', 'get_header', 'get_live_cell', 'get_tip_header'].includes(method)) throw new Error('Use the transaction submission workflow for RPC writes.');
  return retryRead(async () => {
  const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw responseError(response, 'CKB RPC is unavailable.');
  const value = await response.json();
  if (value.error || !('result' in value)) {
    const error = new Error('CKB RPC could not complete verification.');
    error.transient = [-32603, -32000].includes(value.error?.code);
    throw error;
  }
  return value.result;
  });
}
export async function verifyAnchor(proof, rpcUrl, request = fetch) {
  parseProof(proof);
  const tx = await rpc(rpcUrl, 'get_transaction', [proof.txHash], request);
  if (tx?.tx_status?.status !== 'committed' || tx.transaction?.hash?.toLowerCase() !== proof.txHash.toLowerCase()) throw new Error('Backup differs from its committed CKB anchor.');
  const data = tx.transaction.outputs_data?.[proof.outputIndex];
  const anchor = checkBackupAnchor(data, proof);
  if (anchor.version !== (proof.protocol === 'rivet-backup-proof-v2' ? 2 : 1)
    || (anchor.version === 2 && data.toLowerCase() !== encodeBackupAnchor(proof))) throw new Error('Backup differs from its committed CKB anchor.');
  const header = await rpc(rpcUrl, 'get_header', [tx.tx_status.block_hash], request);
  if (!header?.number || header.hash?.toLowerCase() !== tx.tx_status.block_hash?.toLowerCase()) throw new Error('Anchor block header is unavailable or mismatched.');
  return { anchorVersion: anchor.version, blockHeight: BigInt(header.number).toString(), blockHash: tx.tx_status.block_hash };
}
export function decryptBundle(bytes, proof) {
  if (!proof.encryptionKey && !proof.encryptionIv) return bytes;
  if (!/^[a-f0-9]{64}$/i.test(proof.encryptionKey || '') || !/^[a-f0-9]{24}$/i.test(proof.encryptionIv || '') || bytes.length < 16) throw new Error('Invalid AES-GCM recovery key.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(proof.encryptionKey, 'hex'), Buffer.from(proof.encryptionIv, 'hex'));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
}
export async function verifyBundle(bundlePath, proof, restorePath) {
  parseProof(proof);
  const strong = proof.protocol === 'rivet-backup-proof-v2';
  if (strong && sha256(await readFile(bundlePath)) !== proof.bundleSha256.toLowerCase()) throw new Error('Bundle bytes do not match the anchored SHA-256.');
  const temp = await mkdtemp(join(tmpdir(), 'rivet-verify-'));
  try {
    const bare = join(temp, 'verified.git');
    await git(['clone', '--mirror', '--', bundlePath, bare]);
    await git(['fsck', '--full', '--strict'], bare);
    const { stdout } = await git(['log', '--all', '--format=%H'], bare);
    const commits = stdout.trim().split('\n');
    if (strong) commits.sort();
    if (commits.length !== proof.commitCount || commitRoot(commits) !== proof.merkleRoot.toLowerCase()) throw new Error('Bundle commits do not match the anchored Merkle root.');
    const { stdout: refs } = await git(['for-each-ref', '--format=%(refname) %(objectname)'], bare);
    const refRows = refs.trim().split('\n');
    if (strong && refsCommitment(refRows) !== proof.refsHash.toLowerCase()) throw new Error('Bundle refs do not match the anchored refs hash.');
    if (restorePath) {
      // --mirror preserves refs/tags and commit IDs. Never overwrite a target.
      await mkdir(restorePath);
      try {
        await git(['clone', '--mirror', '--no-hardlinks', '--', bare, restorePath]);
        const restored = await git(['for-each-ref', '--format=%(refname) %(objectname)'], restorePath);
        if (restored.stdout !== refs) throw new Error('Restored refs differ from the verified bundle.');
      } catch (error) { await rm(restorePath, { recursive: true, force: true }); throw error; }
    }
    return { commitCount: commits.length, merkleRoot: proof.merkleRoot, refs: refRows,
      ...(strong ? { refsHash: proof.refsHash, bundleSha256: proof.bundleSha256 } : {}),
      limitations: strong ? [] : ['Legacy anchors commit the ordered commit set, not CID, bundle bytes or refs. Refs are preserved from this bundle but are not authenticated by the legacy anchor.'] };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export async function materializeBundle(proof, options, callback) {
  parseProof(proof);
  const max = Number(options.maxBytes ?? 536870912);
  if (!Number.isSafeInteger(max) || max < 1 || max > 2147483648) throw new Error('Invalid download size limit.');
  const temp = await mkdtemp(join(tmpdir(), 'rivet-bundle-'));
  try {
    let bytes;
    if (options.bundle) {
      if ((await stat(options.bundle)).size > max) throw new Error('Bundle exceeds download size limit.');
      bytes = await readFile(options.bundle);
      if (bytes.length > max) throw new Error('Bundle exceeds download size limit.');
    }
    else {
      const gateway = new URL(options.gateway || 'https://ipfs.io/ipfs/');
      if (gateway.protocol !== 'https:') throw new Error('Use an HTTPS IPFS gateway.');
      const response = await retryRead(async () => {
        const response = await fetch(new URL(proof.ipfsCid, gateway.href.replace(/\/?$/, '/')), { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw responseError(response, 'IPFS bundle is unavailable. Provide --bundle for an offline recovery.');
        return response;
      });
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > max) throw new Error('Bundle exceeds download size limit.');
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
    }
    const file = join(temp, 'repository.bundle');
    await writeFile(file, decryptBundle(bytes, proof), { mode: 0o600 });
    return await callback(file);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
