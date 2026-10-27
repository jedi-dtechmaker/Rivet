const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { cotaTypeForLock } = require('../src/lib/cota.ts');
const { buildSmt, EMPTY_ROOT } = require('../src/lib/cota-smt.ts');
const { buildManifest, manifestTokenKeys, manifestHeldLeaves, rootFromCotaProof } = require('../src/lib/cota-manifest.ts');
const { deriveManifestCollectionId, prepareManifestDefine, prepareManifestMint, prepareManifestClaim, prepareManifestUpdate,
  verifyManifestDefine, verifyManifestMint, verifyManifestClaim, createStandardCotaTransaction, validateManifestSigned,
} = require('../src/lib/cota-manifest-chain.ts');

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
// Test-only recursive proof generator, independent of the production stack VM.
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
      const child = zero(left) ? right : left;
      const bit = zero(left) ? 1n << BigInt(height) : 0n;
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
const issuer = ccc.Script.from({ codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: `0x${'22'.repeat(20)}` });
const owner = ccc.Script.from({ codeHash: `0x${'33'.repeat(32)}`, hashType: 'type', args: `0x0001${'44'.repeat(20)}` });
const source = (lock, root = EMPTY_ROOT, txHash = `0x${'55'.repeat(32)}`) => ccc.Cell.from({
  outPoint: { txHash, index: 0 }, cellOutput: { lock, type: cotaTypeForLock(lock), capacity: ccc.fixedPointFrom(150) }, outputData: `0x02${root.slice(2)}`,
});
const client = { getKnownScript: async () => ({ cellDeps: [] }), getCellDeps: async () => [] };
const definitionValue = issued => Buffer.concat([be32(0), be32(issued), Buffer.from([0xf7])]);
const padded = info => hex(Buffer.concat([info, Buffer.alloc(31 - info.length), Buffer.from([255])]));

async function lifecycle(issuerLock = issuer, ownerLock = owner) {
  const issuer = issuerLock, owner = ownerLock;
  const initial = source(issuer);
  const collectionId = deriveManifestCollectionId(initial);
  const defineKey = Buffer.concat([Buffer.from('8100', 'hex'), bytes(collectionId)]);
  const definition = { key: hex(Buffer.concat([defineKey, Buffer.alloc(10)])), value: padded(definitionValue(0)) };
  const defineTree = buildSmt([definition]);
  const defineEntry = table([vector([defineKey]), vector([definitionValue(0)]), moleculeBytes(defineTree.proof), moleculeBytes(Buffer.from('Create a new NFT collection with unlimited edition'))]);
  const defineCalls = [];
  const defined = await prepareManifestDefine(initial, client, async (method, params) => {
    defineCalls.push({ method, params });
    return { smt_root_hash: defineTree.root.slice(2), define_smt_entry: defineEntry.toString('hex') };
  });
  const issueSource = source(issuer, defineTree.root, defined.transaction.hash());
  const manifest = buildManifest({ network: 'ckb-testnet', ownerLockHash: owner.hash(), issuerLockHash: issuer.hash(), githubId: '1001',
    collectionId, indexes: [0, 1], githubUsername: 'generated', backups: [] });
  const sourceSlice = Buffer.from(issueSource.outPoint.toBytes()).subarray(12);
  const withdrawalKeys = [0, 1].map(index => Buffer.concat([Buffer.from('8102', 'hex'), bytes(collectionId), be32(index), sourceSlice]));
  const withdrawalValues = manifest.characteristics.map(part => table([Buffer.concat([Buffer.from([0xf7, 0]), bytes(part)]), moleculeBytes(Buffer.from(owner.toBytes()))]));
  const withdrawalLeaves = withdrawalKeys.map((key, index) => ({ key: ccc.hashCkb(key), value: ccc.hashCkb(withdrawalValues[index]) }));
  const newDefinition = { ...definition, value: padded(definitionValue(2)) };
  const mintLeaves = [newDefinition, ...withdrawalLeaves];
  const mintTree = buildSmt(mintLeaves);
  const mintFields = [vector([defineKey]), vector([definitionValue(0)]), vector([definitionValue(2)]), vector(withdrawalKeys),
    table(withdrawalValues), moleculeBytes(mintTree.proof), moleculeBytes(Buffer.alloc(0))];
  const mintEntry = table(mintFields);
  const mintCalls = [];
  const issuance = await prepareManifestMint(issueSource, owner, manifest.envelope, manifest.outputType, client, async (method, params) => {
    mintCalls.push({ method, params });
    return method === 'get_define_info' ? { total: 0, issued: 0, configure: '0xf7' }
      : { smt_root_hash: mintTree.root.slice(2), mint_smt_entry: mintEntry.toString('hex') };
  });
  const unrelated = { key: `0xff007375626b657900000002${'00'.repeat(20)}`, value: `0x0001${'66'.repeat(20)}${'00'.repeat(9)}ff` };
  const claimSource = source(owner, buildSmt([unrelated]).root, `0x${'77'.repeat(32)}`);
  const held = manifestHeldLeaves(collectionId, [0, 1], manifest.characteristics);
  const claimKeys = [0, 1].map(index => Buffer.concat([Buffer.from('8103', 'hex'), bytes(collectionId), be32(index), sourceSlice]));
  const receipts = claimKeys.map(key => ({ key: ccc.hashCkb(key), value: `0x${'ff'.repeat(32)}` }));
  const claimedLeaves = [...held, ...receipts];
  const claimTree = partialProof([...claimedLeaves, unrelated], new Set(claimedLeaves.map(leaf => leaf.key)));
  const withdrawalProof = partialProof(mintLeaves, new Set(withdrawalLeaves.map(leaf => leaf.key)));
  const blockHash = `0x${'88'.repeat(32)}`;
  const txProof = table([Buffer.alloc(32), table([vector([be32(0)]), vector([])])]);
  const claimFields = [vector(manifestTokenKeys(collectionId, [0, 1]).map(bytes)), vector(held.map(leaf => bytes(leaf.value).subarray(0, 22))),
    vector(claimKeys), vector(claimKeys.map(() => Buffer.concat([Buffer.from([1]), Buffer.alloc(31, 255)]))), moleculeBytes(claimTree.proof),
    moleculeBytes(Buffer.from('Claim 2 NFTs')), vector([]), vector([]), moleculeBytes(withdrawalProof.proof),
    moleculeBytes(Buffer.from(ccc.RawTransaction.encode(issuance))), be32(0), txProof];
  const claimEntry = table(claimFields);
  const claimClient = { ...client, getTransaction: async () => ({ status: 'committed', blockHash, transaction: issuance }) };
  const claimCalls = [];
  const claim = await prepareManifestClaim(claimSource, issuer, manifest.envelope, manifest.outputType, issuance, claimClient, async (method, params) => {
    claimCalls.push({ method, params });
    return { smt_root_hash: claimTree.root.slice(2), claim_smt_entry: claimEntry.toString('hex'), withdraw_block_hash: blockHash.slice(2) };
  });
  return { initial, defined, defineCalls, issueSource, issuance, manifest, mintCalls, mintFields, mintTree, claimSource, claim,
    claimCalls, claimFields, claimTree, blockHash, claimClient, held, receipts, unrelated, collectionId };
}

test('standard define, mint and V2 claim builders use official RPC shapes and preserve wallet authentication state', async () => {
  const value = await lifecycle();
  assert.equal(value.defined.collectionId, value.collectionId);
  assert.equal(value.defineCalls[0].method, 'generate_define_cota_smt');
  assert.equal(value.defineCalls[0].params.configure, '0xf7');
  assert.equal(value.mintCalls[0].method, 'get_define_info');
  assert.equal(value.mintCalls[1].method, 'generate_mint_cota_smt');
  assert.equal(value.mintCalls[1].params.withdrawals[0].to_lock_script, hex(Buffer.from(owner.toBytes())));
  assert.equal(value.claimCalls[0].method, 'generate_claim_cota_smt');
  assert.deepEqual(value.claim.headerDeps, [value.blockHash]);
  assert.equal(verifyManifestDefine(value.initial, value.defined.transaction).collectionId, value.collectionId);
  assert.equal(verifyManifestMint(value.issueSource, owner, value.manifest.envelope, value.issuance).withdrawalLeaves.length, 2);
  const checked = verifyManifestClaim(value.claimSource, issuer, value.manifest.envelope, value.issuance, value.claim);
  assert.deepEqual(checked.receiptLeaves, value.receipts);
  assert.notEqual(value.claimTree.root, buildSmt([...value.held, ...value.receipts]).root, 'Unrelated authentication state remains committed.');
  assert.equal(value.claim.outputs[0].lock.hash(), owner.hash());
  assert.equal(rootFromCotaProof([...checked.heldLeaves, ...checked.receiptLeaves], checked.proof), value.claimTree.root);
});

test('claim rejects unsupported versions, foreign issuance bytes, wrong receipts and unrelated roots before signing', async () => {
  const value = await lifecycle();
  const changedClaim = (index, field) => {
    const fields = [...value.claimFields]; fields[index] = field;
    const result = value.claim.clone(); result.setWitnessArgs(0, { ...result.getWitnessArgs(0), inputType: hex(Buffer.concat([Buffer.from([4]), table(fields)])) });
    return result;
  };
  const check = transaction => verifyManifestClaim(value.claimSource, issuer, value.manifest.envelope, value.issuance, transaction);
  assert.throws(() => check(changedClaim(3, vector([Buffer.alloc(32, 255), Buffer.alloc(32, 255)]))), /receipt/);
  assert.throws(() => check(changedClaim(9, moleculeBytes(Buffer.alloc(10)))), /confirmed issuer transaction/);
  assert.throws(() => check(changedClaim(10, be32(1))), /confirmed issuer transaction/);
  assert.throws(() => check(changedClaim(5, moleculeBytes(Buffer.from('Claim wrong NFTs')))), /action/);
  assert.throws(() => check(changedClaim(8, moleculeBytes(Buffer.from([0x4c])))), /compiled CoTA/);
  const wrongRoot = value.claim.clone(); wrongRoot.outputsData[0] = `0x02${'00'.repeat(32)}`;
  assert.throws(() => check(wrongRoot), /actual cell state/);
  const wrongOwner = value.claim.clone(); wrongOwner.outputs[0].lock = issuer;
  assert.throws(() => check(wrongOwner), /source cell or owner/);
  const fields = [...value.claimFields, moleculeBytes(Buffer.alloc(0))];
  const wrongVersion = value.claim.clone(); wrongVersion.setWitnessArgs(0, { ...wrongVersion.getWitnessArgs(0), inputType: hex(Buffer.concat([Buffer.from([4]), table(fields)])) });
  assert.throws(() => check(wrongVersion), /Molecule table/);
});

test('issuance rejects stale reservations, wrong policy, root changes and minting to a different wallet', async () => {
  const value = await lifecycle();
  let called = false;
  await assert.rejects(() => prepareManifestMint(value.issueSource, owner, value.manifest.envelope, value.manifest.outputType, client, async () => {
    called = true; return { total: 0, issued: 2, configure: '0xf7' };
  }), /indexes changed/);
  assert.equal(called, true);
  const fields = [...value.mintFields]; fields[2] = vector([Buffer.concat([be32(0), be32(2), Buffer.from([0])])]);
  const changed = value.issuance.clone(); changed.setWitnessArgs(0, { ...changed.getWitnessArgs(0), inputType: hex(Buffer.concat([Buffer.from([2]), table(fields)])) });
  assert.throws(() => verifyManifestMint(value.issueSource, owner, value.manifest.envelope, changed), /indexes or policy/);
  const foreign = ccc.Script.from({ ...owner, args: `0x0001${'99'.repeat(20)}` });
  assert.throws(() => verifyManifestMint(value.issueSource, foreign, value.manifest.envelope, value.issuance), /owner or issuer/);
  const wrongRoot = value.issuance.clone(); wrongRoot.outputsData[0] = `0x02${'00'.repeat(32)}`;
  assert.throws(() => verifyManifestMint(value.issueSource, owner, value.manifest.envelope, wrongRoot), /actual cell state/);
});

test('a later atomic update preserves claim receipts and supports the normal wallet-signing validator', async () => {
  const value = await lifecycle();
  const next = buildManifest({ ...value.manifest.envelope, githubUsername: 'renamed', backups: [] });
  const changed = manifestHeldLeaves(value.collectionId, [0, 1], next.characteristics);
  const tree = partialProof([...changed, ...value.receipts, value.unrelated], new Set(changed.map(leaf => leaf.key)));
  const fields = [vector(manifestTokenKeys(value.collectionId, [0, 1]).map(bytes)), vector(value.held.map(leaf => bytes(leaf.value).subarray(0, 22))),
    vector(changed.map(leaf => bytes(leaf.value).subarray(0, 22))), moleculeBytes(tree.proof), moleculeBytes(Buffer.from('Update NFT information'))];
  const current = source(owner, value.claimTree.root, value.claim.hash());
  const transaction = await prepareManifestUpdate(current, next.envelope, next.outputType, client, async (method, params) => {
    assert.equal(method, 'generate_update_cota_smt');
    assert.equal(params.nfts.length, 2);
    return { smt_root_hash: tree.root, update_smt_entry: hex(table(fields)) };
  });
  const signed = transaction.clone(); signed.setWitnessArgs(0, { ...signed.getWitnessArgs(0), lock: '0x1234' });
  assert.doesNotThrow(() => validateManifestSigned(transaction, signed));
  const altered = signed.clone(); altered.setWitnessArgs(0, { ...altered.getWitnessArgs(0), outputType: '0x1234' });
  assert.throws(() => validateManifestSigned(transaction, altered), /differs/);
});

test('production define and mint builders pass the deployed issuer lock and CoTA scripts', {
  skip: !process.env.RIVET_CKB_DEBUGGER || !process.env.RIVET_CKB_FIXTURE,
}, async t => {
  const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { JsonRpcTransformers: rpc } = require('@ckb-ccc/core/advanced');
  const fixture = JSON.parse(readFileSync(process.env.RIVET_CKB_FIXTURE, 'utf8'));
  const signer = new ccc.SignerCkbPrivateKey(new ccc.ClientPublicTestnet(), `0x${'12'.repeat(32)}`);
  const issuerLock = (await signer.getRecommendedAddressObj()).script;
  const ownerLock = ccc.Script.from(rpc.scriptTo(fixture.mock_info.inputs[0].output.lock));
  const value = await lifecycle(issuerLock, ownerLock);
  const directory = mkdtempSync(path.join(tmpdir(), 'rivet-manifest-issuance-'));
  const filename = path.join(directory, 'fixture.json');
  function signed(transaction) {
    const result = transaction.clone();
    result.addCellDeps(fixture.tx.cell_deps.map(rpc.cellDepTo));
    const witness = result.getWitnessArgs(0);
    const placeholder = ccc.WitnessArgs.from({ ...witness, lock: `0x${'00'.repeat(65)}` }).toBytes();
    const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(placeholder.length));
    const digest = ccc.hashCkb(Buffer.concat([bytes(result.hash()), length, placeholder]));
    result.setWitnessArgs(0, { ...witness, lock: ccc.signMessageSecp256k1(digest, signer.privateKey) });
    return result;
  }
  function execute(transaction, cell, script) {
    const local = structuredClone(fixture);
    local.tx = rpc.transactionFrom(transaction);
    local.mock_info.inputs = [{ input: local.tx.inputs[0], output: rpc.cellOutputFrom(cell.cellOutput), data: cell.outputData }];
    writeFileSync(filename, JSON.stringify(local), { mode: 0o600 });
    const result = spawnSync(process.env.RIVET_CKB_DEBUGGER, ['--tx-file', filename, '--script', script], { encoding: 'utf8' });
    assert.ifError(result.error);
    const match = result.stdout.match(/Run result: (-?\d+)/);
    assert.ok(match, result.stderr || result.stdout);
    return Number(match[1]);
  }
  try {
    for (const [name, transaction, cell] of [
      ['define', value.defined.transaction, value.initial], ['mint', value.issuance, value.issueSource],
    ]) {
      await t.test(name, () => {
        const approved = signed(transaction);
        assert.equal(execute(approved, cell, 'input.0.lock'), 0);
        assert.equal(execute(approved, cell, 'input.0.type'), 0);
        const changed = approved.clone(); changed.outputsData[0] = `0x02${'ab'.repeat(32)}`;
        assert.notEqual(execute(signed(changed), cell, 'input.0.type'), 0);
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
