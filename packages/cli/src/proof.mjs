import { createHash, createDecipheriv } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  if (proof?.protocol !== 'rivet-backup-proof-v1' || proof.network !== 'ckb-testnet'
    || !/^0x[a-f0-9]{64}$/i.test(proof.txHash || '') || !/^0x[a-f0-9]{64}$/i.test(proof.merkleRoot || '')
    || !Number.isSafeInteger(proof.outputIndex) || proof.outputIndex < 0
    || !Number.isSafeInteger(proof.commitCount) || proof.commitCount < 1
    || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/.test(proof.ipfsCid || '')) throw new Error('Invalid testnet backup proof.');
  return proof;
}
export async function rpc(url, method, params, request = fetch) {
  const endpoint = new URL(url);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid RPC URL.');
  const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('CKB RPC is unavailable.');
  const value = await response.json();
  if (value.error || !('result' in value)) throw new Error('CKB RPC could not complete verification.');
  return value.result;
}
export async function verifyAnchor(proof, rpcUrl, request = fetch) {
  parseProof(proof);
  const tx = await rpc(rpcUrl, 'get_transaction', [proof.txHash], request);
  if (tx?.tx_status?.status !== 'committed' || tx.transaction?.hash !== proof.txHash
    || tx.transaction.outputs_data?.[proof.outputIndex]?.toLowerCase() !== proof.merkleRoot.toLowerCase()) throw new Error('Backup differs from its committed CKB anchor.');
  const header = await rpc(rpcUrl, 'get_header', [tx.tx_status.block_hash], request);
  if (!header?.number) throw new Error('Anchor block header is unavailable.');
  return { blockHeight: BigInt(header.number).toString(), blockHash: tx.tx_status.block_hash };
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
  const temp = await mkdtemp(join(tmpdir(), 'rivet-verify-'));
  try {
    const bare = join(temp, 'verified.git');
    await git(['clone', '--mirror', '--', bundlePath, bare]);
    await git(['fsck', '--full', '--strict'], bare);
    const { stdout } = await git(['log', '--all', '--format=%H'], bare);
    const commits = stdout.trim().split('\n');
    if (commits.length !== proof.commitCount || commitRoot(commits) !== proof.merkleRoot.toLowerCase()) throw new Error('Bundle commits do not match the anchored Merkle root.');
    const { stdout: refs } = await git(['for-each-ref', '--format=%(refname) %(objectname)'], bare);
    if (restorePath) {
      // --mirror preserves refs/tags and commit IDs. Never overwrite a target.
      await git(['clone', '--mirror', '--', bare, restorePath]);
      const restored = await git(['for-each-ref', '--format=%(refname) %(objectname)'], restorePath);
      if (restored.stdout !== refs) throw new Error('Restored refs differ from the verified bundle.');
    }
    return { commitCount: commits.length, merkleRoot: proof.merkleRoot, refs: refs.trim().split('\n'),
      limitations: ['Legacy anchors commit the ordered commit set, not CID, bundle bytes or refs. Refs are preserved from this bundle but are not authenticated by the legacy anchor.'] };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export async function materializeBundle(proof, options, callback) {
  const temp = await mkdtemp(join(tmpdir(), 'rivet-bundle-'));
  try {
    let bytes;
    if (options.bundle) bytes = await readFile(options.bundle);
    else {
      const gateway = new URL(options.gateway || 'https://ipfs.io/ipfs/');
      if (gateway.protocol !== 'https:') throw new Error('Use an HTTPS IPFS gateway.');
      const response = await fetch(new URL(proof.ipfsCid, gateway.href.replace(/\/?$/, '/')), { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('IPFS bundle is unavailable. Provide --bundle for an offline recovery.');
      const max = Number(options.maxBytes || 536870912);
      if (!Number.isSafeInteger(max) || max < 1 || max > 2147483648) throw new Error('Invalid download size limit.');
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
