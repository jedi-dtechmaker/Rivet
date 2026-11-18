import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git, verifyBundle, rpc } from './proof.mjs';
import { sha256, refsCommitment } from './anchor.mjs';

export const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const PUBLIC_FIELDS = ['protocol', 'network', 'repository', 'txHash', 'outputIndex', 'merkleRoot', 'refsHash', 'bundleSha256', 'commitCount', 'ipfsCid'];
export const publicProof = proof => Object.fromEntries(PUBLIC_FIELDS.filter(key => proof[key] !== undefined).map(key => [key, proof[key]]));
const keyBytes = key => createPublicKey(key).export({ format: 'der', type: 'spki' });
const fingerprint = bytes => sha256(bytes);
const objectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

export function emailMappings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('Attribution needs 1–100 email mappings.');
  const seen = new Set();
  return value.map(row => {
    if (!row || Object.keys(row).sort().join(',') !== 'from,to'
      || ![row.from, row.to].every(email => typeof email === 'string' && /^[^\s<>\x00-\x1f@]+@[^\s<>\x00-\x1f@]+$/.test(email) && email.length < 255)
      || row.from === row.to || seen.has(row.from)) throw new Error('Attribution has an invalid or duplicate email mapping.');
    seen.add(row.from);
    return { from: row.from, to: row.to };
  }).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
}

export async function generateOwnerKey(file) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // Exclusive files prevent replacing an established owner key.
  await writeFile(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  try { await writeFile(`${file}.pub`, publicKey.export({ format: 'pem', type: 'spki' }), { flag: 'wx', mode: 0o644 }); }
  catch (error) { await rm(file, { force: true }); throw error; }
  return { privateKeyFile: file, publicKeyFile: `${file}.pub`, ownerKeyId: fingerprint(keyBytes(privateKey)) };
}

async function repositoryState(bare) {
  const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)'], bare)).stdout.trim().split('\n');
  const commits = (await git(['rev-list', '--all'], bare)).stdout.trim().split('\n').sort();
  return { refs, refsHash: refsCommitment(refs), commits };
}

async function rewrite(original, rewritten, mappings, workspace) {
  let version;
  try { version = (await git(['filter-repo', '--version'])).stdout.trim(); }
  catch { throw new Error('Attribution requires Python 3 and git-filter-repo on PATH. Install git-filter-repo 2.47.0.'); }
  const before = await repositoryState(original);
  if (before.refs.some(row => row.startsWith('refs/replace/'))) throw new Error('Attribution does not support replace refs. Keep the exact recovery copy.');
  await git(['clone', '--mirror', '--no-hardlinks', '--', original, rewritten]);
  const mailmap = join(workspace, 'mailmap');
  await writeFile(mailmap, mappings.map(({ from, to }) => `<${to}> <${from}>`).join('\n') + '\n');
  await git(['filter-repo', '--force', '--mailmap', mailmap, '--preserve-commit-hashes', '--preserve-commit-encoding',
    '--prune-empty', 'never', '--prune-degenerate', 'never', '--replace-refs', 'delete-no-add'], rewritten);
  await git(['fsck', '--full', '--strict'], rewritten);
  const rows = (await readFile(join(rewritten, 'filter-repo', 'commit-map'), 'utf8')).trim().split('\n').slice(1);
  const commits = rows.map(row => {
    const [old, current, extra] = row.trim().split(/\s+/);
    if (extra || !objectId.test(old) || !objectId.test(current) || /^0+$/.test(current)) throw new Error('Attribution produced an incomplete commit mapping.');
    return { old, new: current };
  }).sort((a, b) => a.old < b.old ? -1 : a.old > b.old ? 1 : 0);
  const after = await repositoryState(rewritten);
  if (canonical(commits.map(row => row.old)) !== canonical(before.commits)
    || canonical([...new Set(commits.map(row => row.new))].sort()) !== canonical(after.commits)) {
    throw new Error('Attribution produced an incomplete commit mapping.');
  }
  return { tool: { name: 'git-filter-repo', version }, commits, rewritten: { refs: after.refs, refsHash: after.refsHash, commitCount: after.commits.length } };
}

export async function restoreAttribution(bundle, proof, target, mappingsValue, privateKeyPem) {
  if (proof.protocol !== 'rivet-backup-proof-v2') throw new Error('Attribution requires a v2 backup with authenticated bytes and refs.');
  const mappings = emailMappings(mappingsValue), key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Attribution requires an Ed25519 owner signing key.');
  await mkdir(target, { mode: 0o700 });
  try {
    const original = join(target, 'original.git'), rewritten = join(target, 'rewritten.git');
    await verifyBundle(bundle, proof, original);
    const result = await rewrite(original, rewritten, mappings, target);
    const publicKey = keyBytes(key);
    const payload = { protocol: 'rivet-attribution-proof-v1', network: 'ckb-testnet', source: publicProof(proof),
      emailMappings: mappings, ...result, ownerPublicKey: publicKey.toString('base64'), ownerKeyId: fingerprint(publicKey),
      signatureEffects: 'Rewritten commit IDs change. Original commit and tag signatures are removed by git-filter-repo; original.git preserves the exact signed objects.' };
    const document = { payload, signature: sign(null, Buffer.from(canonical(payload)), key).toString('base64') };
    const file = join(target, 'mapping.json');
    await writeFile(file, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rm(join(target, 'mailmap'));
    return { original, restored: rewritten, mappingFile: file, mappingDigest: mappingDigest(document), ownerKeyId: payload.ownerKeyId,
      commitCount: result.commits.length, refsHash: result.rewritten.refsHash, signatureEffects: payload.signatureEffects };
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}

export function verifyMappingSignature(document, trustedPublicKeyPem) {
  const payload = document?.payload;
  if (payload?.protocol !== 'rivet-attribution-proof-v1' || payload.network !== 'ckb-testnet'
    || Object.keys(document).sort().join(',') !== 'payload,signature') throw new Error('Attribution mapping format is invalid.');
  const trusted = createPublicKey(trustedPublicKeyPem);
  const trustedBytes = trusted.export({ format: 'der', type: 'spki' });
  if (trusted.asymmetricKeyType !== 'ed25519' || payload.ownerPublicKey !== trustedBytes.toString('base64')
    || payload.ownerKeyId !== fingerprint(trustedBytes)
    || !verify(null, Buffer.from(canonical(payload)), trusted, Buffer.from(document.signature, 'base64'))) {
    throw new Error('Attribution signature differs from the trusted owner key.');
  }
  return payload;
}
export const mappingDigest = document => sha256(canonical(document));
export const mappingAnchorData = document => `0x52564d01${mappingDigest(document).slice(2)}`;

/** Reproduce the rewrite from the independently verified original, checking every commit and ref. */
export async function verifyAttribution(document, trustedPublicKeyPem, original, rewritten, proof) {
  const payload = verifyMappingSignature(document, trustedPublicKeyPem);
  if (proof.protocol !== 'rivet-backup-proof-v2' || canonical(payload.source) !== canonical(publicProof(proof))) throw new Error('Attribution source differs from the verified backup.');
  const temp = await mkdtemp(join(tmpdir(), 'rivet-attribution-'));
  try {
    const expected = await rewrite(original, join(temp, 'expected.git'), emailMappings(payload.emailMappings), temp);
    if (canonical(expected.commits) !== canonical(payload.commits) || canonical(expected.rewritten) !== canonical(payload.rewritten)) {
      throw new Error('Attribution mapping does not reproduce the original history.');
    }
    const actual = await repositoryState(rewritten);
    await git(['fsck', '--full', '--strict'], rewritten);
    if (canonical(actual.refs) !== canonical(expected.rewritten.refs)
      || canonical(actual.commits) !== canonical([...new Set(expected.commits.map(row => row.new))].sort())) throw new Error('Attribution restored repository differs from its signed mapping.');
    return { valid: true, mappingDigest: mappingDigest(document), ownerKeyId: payload.ownerKeyId, commitCount: expected.commits.length };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function verifyMappingAnchor(document, txHash, outputIndex, rpcUrl, request = fetch) {
  if (!/^0x[a-f0-9]{64}$/i.test(txHash) || !Number.isSafeInteger(outputIndex) || outputIndex < 0) throw new Error('Attribution anchor reference is invalid.');
  const result = await rpc(rpcUrl, 'get_transaction', [txHash], request);
  if (result?.tx_status?.status !== 'committed' || result.transaction?.hash?.toLowerCase() !== txHash.toLowerCase()
    || result.transaction.outputs_data?.[outputIndex]?.toLowerCase() !== mappingAnchorData(document)) throw new Error('Attribution mapping differs from its committed CKB anchor.');
  const header = await rpc(rpcUrl, 'get_header', [result.tx_status.block_hash], request);
  if (header?.hash !== result.tx_status.block_hash || !header.number) throw new Error('Attribution anchor header is unavailable.');
  return { txHash, outputIndex, blockHeight: BigInt(header.number).toString(), blockHash: header.hash };
}
