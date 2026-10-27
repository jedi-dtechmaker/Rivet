const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { TESTNET_SCRIPTS } = require('@ckb-ccc/core/advanced');
const { cotaTypeForLock } = require('../src/lib/cota.ts');
const { buildSmt, EMPTY_ROOT } = require('../src/lib/cota-smt.ts');
const { buildManifest, manifestTokenKeys, manifestHeldLeaves } = require('../src/lib/cota-manifest.ts');
const { deriveManifestCollectionId, prepareManifestDefine, prepareManifestMint, prepareManifestClaim, prepareManifestUpdate } = require('../src/lib/cota-manifest-chain.ts');
const { MANIFEST_PROOF_PROTOCOL, parseManifestProofPackage, verifyManifestProofPackage } = require('../src/lib/cota-manifest-verify.ts');

const hex = value => `0x${value.toString('hex')}`;
const bytes = value => Buffer.from(value.slice(2), 'hex');
const u32 = value => { const raw = Buffer.alloc(4); raw.writeUInt32LE(value); return raw; };
const be32 = value => { const raw = Buffer.alloc(4); raw.writeUInt32BE(value); return raw; };
const vector = values => Buffer.concat([u32(values.length), ...values]);
const moleculeBytes = raw => Buffer.concat([u32(raw.length), raw]);
function table(fields) {
  let length = 4 * (fields.length + 1);
  const offsets = fields.map(field => { const previous = length; length += field.length; return u32(previous); });
  return Buffer.concat([u32(length), ...offsets, ...fields]);
}

// Test-only recursive tree builder supplies proofs independent of the verifier's
// compiled-proof interpreter, including unknown authentication/receipt leaves.
function partialProof(leaves, queried) {
  const sorted = leaves.map(leaf => ({ ...leaf, path: BigInt(`0x${Buffer.from(bytes(leaf.key)).reverse().toString('hex')}`) }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const keyBytes = path => Buffer.from(path.toString(16).padStart(64, '0'), 'hex').reverse();
  const hash = (...parts) => ccc.hashCkb(Buffer.concat(parts));
  const nodeHash = node => 'hash' in node ? node.hash : hash(Buffer.from([2]), bytes(node.base), keyBytes(node.bits), Buffer.from([node.count]));
  const zero = node => 'hash' in node && node.hash === EMPTY_ROOT;
  function merge(height, path, left, right) {
    if (zero(left) && zero(right)) return { hash: EMPTY_ROOT };
    if (zero(left) || zero(right)) {
      const child = zero(left) ? right : left, bit = zero(left) ? 1n << BigInt(height) : 0n;
      return 'hash' in child ? { base: hash(Buffer.from([height]), keyBytes(path), bytes(child.hash)), bits: bit, count: 1 }
        : { base: child.base, bits: child.bits | bit, count: (child.count + 1) % 256 };
    }
    return { hash: hash(Buffer.from([1, height]), keyBytes(path), bytes(nodeHash(left)), bytes(nodeHash(right))) };
  }
  const proof = [];
  function walk(items, height, path) {
    if (!items.length) return { node: { hash: EMPTY_ROOT }, query: false };
    if (height < 0) { const query = queried.has(items[0].key); if (query) proof.push(0x4c); return { node: { hash: items[0].value }, query }; }
    const bit = 1n << BigInt(height), split = items.findIndex(item => (item.path & bit) !== 0n);
    const left = walk(split < 0 ? items : items.slice(0, split), height - 1, path);
    const right = walk(split < 0 ? [] : items.slice(split), height - 1, path | bit);
    if (left.query && right.query) proof.push(0x48);
    else if (left.query || right.query) {
      const sibling = left.query ? right.node : left.node;
      if (zero(sibling)) proof.push(0x4f, 1);
      else if ('hash' in sibling) proof.push(0x50, ...bytes(sibling.hash));
      else proof.push(0x51, sibling.count, ...bytes(sibling.base), ...keyBytes(sibling.bits));
    }
    return { node: merge(height, path, left.node, right.node), query: left.query || right.query };
  }
  const root = nodeHash(walk(sorted, 255, 0n).node);
  assert.equal(root, buildSmt(leaves).root);
  return { root, proof: Buffer.from(proof) };
}

async function fixture({ wrongAnchor = false, detachedUpdate = false } = {}) {
  const issuer = ccc.Script.from({ codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: `0x${'22'.repeat(20)}` });
  const joyId = TESTNET_SCRIPTS[ccc.KnownScript.JoyId];
  const owner = ccc.Script.from({ codeHash: joyId.codeHash, hashType: joyId.hashType, args: `0x0001${'44'.repeat(20)}` });
  const transactions = new Map();
  const calls = new Map();
  const blockHash = `0x${'88'.repeat(32)}`;
  // The RPC fixture models consensus-confirmed transactions. Dummy nonempty
  // lock bytes are intentional: these tests do not execute CKB lock scripts.
  const signed = transaction => { transaction.setWitnessArgs(0, { ...transaction.getWitnessArgs(0), lock: '0x1234' }); return transaction; };
  const remember = transaction => { transactions.set(transaction.hash(), { status: 'committed', transaction, blockHash }); return transaction; };
  const cell = (transaction, index = 0) => ccc.Cell.from({ outPoint: { txHash: transaction.hash(), index }, cellOutput: transaction.outputs[index], outputData: transaction.outputsData[index] });
  const seed = (lock, root) => remember(ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: `0x${'55'.repeat(32)}`, index: 0 } }],
    outputs: [{ lock, type: cotaTypeForLock(lock), capacity: ccc.fixedPointFrom(150) }], outputsData: [`0x02${root.slice(2)}`],
  }));
  const client = {
    addressPrefix: 'ckt',
    getKnownScript: async () => ({ cellDeps: [] }), getCellDeps: async () => [],
    getTransaction: async hash => { calls.set(hash, (calls.get(hash) || 0) + 1); return transactions.get(hash); },
  };
  const initial = cell(seed(issuer, EMPTY_ROOT));
  const collectionId = deriveManifestCollectionId(initial);
  const defineKey = Buffer.concat([Buffer.from('8100', 'hex'), bytes(collectionId)]);
  const definitionValue = issued => Buffer.concat([be32(0), be32(issued), Buffer.from([0xf7])]);
  const padded = info => hex(Buffer.concat([info, Buffer.alloc(31 - info.length), Buffer.from([255])]));
  const definition = { key: hex(Buffer.concat([defineKey, Buffer.alloc(10)])), value: padded(definitionValue(0)) };
  const defineTree = buildSmt([definition]);
  const defineEntry = table([vector([defineKey]), vector([definitionValue(0)]), moleculeBytes(defineTree.proof), moleculeBytes(Buffer.from('Create a new NFT collection with unlimited edition'))]);
  const defined = await prepareManifestDefine(initial, client, async () => ({ smt_root_hash: defineTree.root, define_smt_entry: hex(defineEntry) }));
  remember(signed(defined.transaction));
  const issueSource = cell(defined.transaction);
  const backupRoot = `0x${'ab'.repeat(32)}`;
  const anchor = remember(ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: `0x${'aa'.repeat(32)}`, index: 0 } }],
    outputs: [{ lock: issuer, capacity: ccc.fixedPointFrom(100) }], outputsData: [backupRoot] }));
  const backup = repositoryId => ({ repositoryId, repository: `generated/repo-${repositoryId}`, ipfsCid: 'bafy-generated-proof',
    merkleRoot: wrongAnchor ? `0x${'cd'.repeat(32)}` : backupRoot, anchorOutpoint: `${anchor.hash()}:0`, commitCount: 3 });
  const initialManifest = buildManifest({ network: 'ckb-testnet', ownerLockHash: owner.hash(), issuerLockHash: issuer.hash(), githubId: '1001',
    collectionId, indexes: [0, 1], githubUsername: 'generated', backups: [backup('2001')] });
  const sourceSlice = Buffer.from(issueSource.outPoint.toBytes()).subarray(12);
  const withdrawalKeys = [0, 1].map(index => Buffer.concat([Buffer.from('8102', 'hex'), bytes(collectionId), be32(index), sourceSlice]));
  const withdrawalValues = initialManifest.characteristics.map(part => table([Buffer.concat([Buffer.from([0xf7, 0]), bytes(part)]), moleculeBytes(Buffer.from(owner.toBytes()))]));
  const withdrawalLeaves = withdrawalKeys.map((key, index) => ({ key: ccc.hashCkb(key), value: ccc.hashCkb(withdrawalValues[index]) }));
  const mintLeaves = [{ ...definition, value: padded(definitionValue(2)) }, ...withdrawalLeaves];
  const mintTree = buildSmt(mintLeaves);
  const mintEntry = table([vector([defineKey]), vector([definitionValue(0)]), vector([definitionValue(2)]), vector(withdrawalKeys),
    table(withdrawalValues), moleculeBytes(mintTree.proof), moleculeBytes(Buffer.alloc(0))]);
  const issuance = remember(signed(await prepareManifestMint(issueSource, owner, initialManifest.envelope, initialManifest.outputType, client, async method => method === 'get_define_info'
    ? { total: 0, issued: 0, configure: '0xf7' } : { smt_root_hash: mintTree.root, mint_smt_entry: hex(mintEntry) })));
  const unrelated = { key: `0xff007375626b657900000002${'00'.repeat(20)}`, value: `0x0001${'66'.repeat(20)}${'00'.repeat(9)}ff` };
  const claimSource = cell(seed(owner, buildSmt([unrelated]).root));
  const held = manifestHeldLeaves(collectionId, [0, 1], initialManifest.characteristics);
  const claimKeys = [0, 1].map(index => Buffer.concat([Buffer.from('8103', 'hex'), bytes(collectionId), be32(index), sourceSlice]));
  const receipts = claimKeys.map(key => ({ key: ccc.hashCkb(key), value: `0x${'ff'.repeat(32)}` }));
  const claimedLeaves = [...held, ...receipts];
  const claimTree = partialProof([...claimedLeaves, unrelated], new Set(claimedLeaves.map(leaf => leaf.key)));
  const withdrawalProof = partialProof(mintLeaves, new Set(withdrawalLeaves.map(leaf => leaf.key)));
  const txProof = table([Buffer.alloc(32), table([vector([be32(0)]), vector([])])]);
  const claimEntry = table([vector(manifestTokenKeys(collectionId, [0, 1]).map(bytes)), vector(held.map(leaf => bytes(leaf.value).subarray(0, 22))),
    vector(claimKeys), vector(claimKeys.map(() => Buffer.concat([Buffer.from([1]), Buffer.alloc(31, 255)]))), moleculeBytes(claimTree.proof),
    moleculeBytes(Buffer.from('Claim 2 NFTs')), vector([]), vector([]), moleculeBytes(withdrawalProof.proof),
    moleculeBytes(Buffer.from(ccc.RawTransaction.encode(issuance))), be32(0), txProof]);
  const claim = remember(signed(await prepareManifestClaim(claimSource, issuer, initialManifest.envelope, initialManifest.outputType, issuance, client,
    async () => ({ smt_root_hash: claimTree.root, claim_smt_entry: hex(claimEntry), withdraw_block_hash: blockHash }))));
  const latest = buildManifest({ ...initialManifest.envelope, githubUsername: 'renamed', backups: [backup('2001'), backup('2002')] });
  const changed = manifestHeldLeaves(collectionId, [0, 1], latest.characteristics);
  const updatedTree = partialProof([...changed, ...receipts, unrelated], new Set(changed.map(leaf => leaf.key)));
  const updateEntry = table([vector(manifestTokenKeys(collectionId, [0, 1]).map(bytes)), vector(held.map(leaf => bytes(leaf.value).subarray(0, 22))),
    vector(changed.map(leaf => bytes(leaf.value).subarray(0, 22))), moleculeBytes(updatedTree.proof), moleculeBytes(Buffer.from('Update NFT information'))]);
  const updateSource = detachedUpdate ? cell(seed(owner, claimTree.root)) : cell(claim);
  const update = remember(signed(await prepareManifestUpdate(updateSource, latest.envelope, latest.outputType, client,
    async () => ({ smt_root_hash: updatedTree.root, update_smt_entry: hex(updateEntry) }))));
  calls.clear();
  const binding = { network: 'ckb-testnet', ownerLockHash: owner.hash(), issuerLockHash: issuer.hash(), githubId: '1001', collectionId, indexes: [0, 1] };
  const proof = { protocol: MANIFEST_PROOF_PROTOCOL, network: 'ckb-testnet', binding, issuanceTxHash: issuance.hash(), claimTxHash: claim.hash(), manifestTxHash: update.hash(), manifestRoot: latest.root };
  return { proof, client, transactions, calls, issuer, owner, issuance, claim, update, anchor, initialManifest, latest };
}

const verify = value => verifyManifestProofPackage(value.proof, { expectedIssuerLockHash: value.issuer.hash(), client: value.client });

test('public RPC verification checks mint, claim, atomic update and backup anchors without Rivet or a database', async () => {
  const value = await fixture();
  const result = await verify(value);
  assert.equal(result.valid, true);
  assert.equal(result.githubId, '1001');
  assert.equal(result.githubUsername, 'renamed');
  assert.equal(result.manifestRoot, value.latest.root);
  assert.equal(result.backupCount, 2);
  assert.equal(result.verifiedAnchorCount, 1);
  assert.equal(result.fetchedTransactionCount, value.calls.size);
  assert.ok([...value.calls.values()].every(count => count === 1), 'Every distinct chain transaction is fetched once.');
  assert.match(result.limitations.join(' '), /IPFS availability.*newest CoTA/);
});

test('an initial claim is independently verifiable before any later update', async () => {
  const value = await fixture();
  value.proof.manifestTxHash = value.claim.hash();
  value.proof.manifestRoot = value.initialManifest.root;
  assert.equal((await verify(value)).backupCount, 1);
});

test('a proof cannot choose its own trusted issuer or substitute another GitHub identity', async () => {
  const value = await fixture();
  await assert.rejects(() => verifyManifestProofPackage(value.proof, { client: value.client }), /independently trusted issuer/);
  await assert.rejects(() => verifyManifestProofPackage(value.proof, { client: value.client, expectedIssuerLockHash: `0x${'99'.repeat(32)}` }), /independently trusted Rivet issuer/);
  assert.equal(value.calls.size, 0);
  value.proof.binding.githubId = '9999';
  await assert.rejects(() => verify(value), /GitHub account/);
});

test('unconfirmed transactions, wrong chain responses and unsupported networks fail closed', async () => {
  const value = await fixture();
  value.transactions.get(value.anchor.hash()).status = 'pending';
  await assert.rejects(() => verify(value), /not committed/);
  value.transactions.get(value.anchor.hash()).status = 'committed';
  value.transactions.set(value.proof.manifestTxHash, { status: 'committed', transaction: value.claim });
  await assert.rejects(() => verify(value), /different hash/);
  await assert.rejects(() => verifyManifestProofPackage(value.proof, { expectedIssuerLockHash: value.issuer.hash(), client: { ...value.client, addressPrefix: 'ckb' } }), /testnet client/);
});

test('missing approval witnesses, inconsistent exported roots and wrong backup anchor roots are rejected', async () => {
  const value = await fixture();
  value.proof.manifestRoot = EMPTY_ROOT;
  await assert.rejects(() => verify(value), /exported root/);
  value.proof.manifestRoot = value.latest.root;
  const witness = value.update.getWitnessArgs(0);
  value.update.setWitnessArgs(0, { ...witness, lock: '0x' });
  await assert.rejects(() => verify(value), /signed manifest witness/);
  const inconsistent = await fixture({ wrongAnchor: true });
  await assert.rejects(() => verify(inconsistent), /committed CKB anchor/);
});

test('the latest update must descend from the declared owner claim', async () => {
  const detached = await fixture({ detachedUpdate: true });
  await assert.rejects(() => verify(detached), /not committed|original claimed CoTA cell/);
});

test('the claim must reference the actual issuance block and verification is bounded', async () => {
  const value = await fixture();
  await assert.rejects(() => verifyManifestProofPackage(value.proof, { expectedIssuerLockHash: value.issuer.hash(), client: value.client, maxTransactions: 1 }), /transaction verification limit/);
  value.transactions.get(value.issuance.hash()).blockHash = `0x${'99'.repeat(32)}`;
  await assert.rejects(() => verify(value), /issuance block/);
  assert.throws(() => parseManifestProofPackage({ ...value.proof, verified: true }), /proof fields/);
});
