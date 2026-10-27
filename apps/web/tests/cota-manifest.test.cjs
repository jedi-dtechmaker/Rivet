const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const {
  MANIFEST_PROTOCOL, buildManifest, manifestRootShards, rootFromManifestShards,
  parseManifestEnvelope, restoreIssuedManifest, manifestTokenKeys, manifestHeldLeaves, parseManifestUpdate,
  rootFromCotaProof, verifyManifestUpdate, readMoleculeTable, readFixedVector, readMoleculeBytes,
} = require('../src/lib/cota-manifest.ts');
const { buildSmt, EMPTY_ROOT, commitmentKey } = require('../src/lib/cota-smt.ts');

const hex = buffer => `0x${buffer.toString('hex')}`;
const bytes = value => Buffer.from(value.slice(2), 'hex');
const u32 = number => { const value = Buffer.alloc(4); value.writeUInt32LE(number); return value; };
const vector = values => Buffer.concat([u32(values.length), ...values]);
const moleculeBytes = value => Buffer.concat([u32(value.length), value]);
function table(fields) {
  let length = 4 * (fields.length + 1);
  const offsets = fields.map(field => { const offset = length; length += field.length; return u32(offset); });
  return Buffer.concat([u32(length), ...offsets, ...fields]);
}
const binding = { network: 'ckb-testnet', ownerLockHash: `0x${'11'.repeat(32)}`,
  issuerLockHash: `0x${'22'.repeat(32)}`, githubId: '1001', collectionId: `0x${'33'.repeat(20)}`, indexes: [0, 1] };
const backup = { repositoryId: '2001', repository: 'developer/project', ipfsCid: 'bafy-public-backup',
  merkleRoot: `0x${'44'.repeat(32)}`, anchorOutpoint: `0x${'55'.repeat(32)}:0`, commitCount: 9 };
const create = (overrides = {}) => buildManifest({ ...binding, githubUsername: 'developer', backups: [backup], ...overrides });

test('claim restoration reuses exact issued bytes after JSONB reorders nested object fields', () => {
  const manifest = create();
  const reorder = value => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
  const saved = reorder(manifest.envelope);
  assert.notEqual(JSON.stringify(saved), JSON.stringify(manifest.envelope));
  assert.throws(() => parseManifestEnvelope(hex(Buffer.from(JSON.stringify(saved))), binding), /canonically encoded/);
  assert.deepEqual(restoreIssuedManifest(manifest.outputType, saved, binding), manifest.envelope);
  assert.throws(() => restoreIssuedManifest(manifest.outputType, { ...saved, manifestRoot: EMPTY_ROOT }, binding), /saved enrollment/);
  const changed = structuredClone(saved); changed.records[0].record.ipfsCid = 'bafy-other';
  assert.throws(() => restoreIssuedManifest(manifest.outputType, changed, binding), /saved enrollment/);
});

function updateWitness(oldLeaves, newLeaves, proof, changes = {}) {
  const keys = manifestTokenKeys(binding.collectionId, binding.indexes).map(bytes);
  const fields = [vector(keys), vector(oldLeaves.map(leaf => bytes(leaf.value).subarray(0, 22))),
    vector(newLeaves.map(leaf => bytes(leaf.value).subarray(0, 22))), moleculeBytes(bytes(proof)),
    moleculeBytes(Buffer.from('Update NFT information'))];
  for (const [index, value] of Object.entries(changes)) fields[Number(index)] = value;
  return hex(Buffer.concat([Buffer.from([5]), table(fields)]));
}

function updateFixture(includeUnknown = false) {
  const manifest = create();
  const oldLeaves = manifestHeldLeaves(binding.collectionId, binding.indexes, manifestRootShards(EMPTY_ROOT));
  const newLeaves = manifestHeldLeaves(binding.collectionId, binding.indexes, manifest.characteristics);
  let proof = buildSmt(newLeaves).proof;
  const additional = [];
  if (includeUnknown) {
    // The unknown wallet leaf occupies the right half of the tree. Its compact
    // sibling node is carried in the proof, without revealing/rebuilding it.
    const key = `0x${'00'.repeat(31)}80`, value = `0x${'77'.repeat(32)}`;
    additional.push({ key, value });
    const base = bytes(ccc.hashCkb(Buffer.concat([Buffer.from([0]), bytes(key), bytes(value)])));
    assert.deepEqual(proof.subarray(-2), Buffer.from([0x4f, 1]));
    proof = Buffer.concat([proof.subarray(0, -2), Buffer.from([0x51, 255]), base, Buffer.alloc(32)]);
  }
  return { manifest, oldLeaves, newLeaves, proof: hex(proof),
    previousCotaRoot: buildSmt([...oldLeaves, ...additional]).root,
    cotaRoot: buildSmt([...newLeaves, ...additional]).root,
    inputType: updateWitness(oldLeaves, newLeaves, hex(proof)), outputType: manifest.outputType };
}

test('manifest canonicalization binds identity, immutable repository IDs and every backup commitment', () => {
  const original = create();
  assert.equal(original.envelope.protocol, MANIFEST_PROTOCOL);
  assert.equal(parseManifestEnvelope(original.outputType, binding).manifestRoot, original.root);
  const reordered = create({ backups: [Object.fromEntries(Object.entries(backup).reverse())] });
  assert.equal(reordered.outputType, original.outputType);
  const before = original.envelope.records.find(entry => entry.record.kind === 'backup');
  const renamed = create({ backups: [{ ...backup, repository: 'new-owner/new-name' }] });
  assert.equal(renamed.envelope.records.find(entry => entry.record.kind === 'backup').key, before.key);
  assert.notEqual(renamed.root, original.root);
  assert.notEqual(before.key, commitmentKey(`backup:${backup.repository}`), 'Legacy display-name keys are not silently reused.');
  for (const [field, value] of Object.entries({ repositoryId: '2002', ipfsCid: 'bafy-new-backup', merkleRoot: EMPTY_ROOT,
    anchorOutpoint: `0x${'66'.repeat(32)}:1`, commitCount: 10 })) {
    assert.notEqual(create({ backups: [{ ...backup, [field]: value }] }).root, original.root, field);
  }
  assert.throws(() => create({ backups: [backup, backup] }), /Duplicate/);
  assert.throws(() => create({ githubId: '001' }), /immutable GitHub ID/);
  assert.throws(() => create({ backups: [{ ...backup, repositoryId: undefined }] }), /immutable GitHub ID/);
  assert.throws(() => create({ backups: [{ ...backup, commitCount: -1 }] }), /commit count/);
  assert.throws(() => create({ backups: [{ ...backup, anchorOutpoint: `${backup.anchorOutpoint}0` }] }), /anchor outpoint/);
  assert.throws(() => create({ indexes: [1, 1] }), /distinct and ordered/);
});

test('two characteristic shards retain all 256 root bits and reject hidden padding data', () => {
  const root = `0x${Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')}`;
  const shards = manifestRootShards(root);
  assert.equal(shards[0], '0x000102030405060708090a0b0c0d0e0f10111213');
  assert.equal(shards[1], '0x1415161718191a1b1c1d1e1f0000000000000000');
  assert.equal(rootFromManifestShards(shards), root);
  assert.throws(() => rootFromManifestShards([shards[0], `${shards[1].slice(0, -2)}01`]), /padding/);
  assert.throws(() => rootFromManifestShards([shards[1], shards[0]]), /padding/);
  assert.throws(() => rootFromManifestShards([shards[0]]), /exactly two/);
  assert.throws(() => manifestRootShards(shards[0]), /hexadecimal/);
});

test('manifest parsing requires an externally trusted issuer/owner/account/token binding and canonical encoding', () => {
  const manifest = create();
  for (const overrides of [{ ownerLockHash: EMPTY_ROOT }, { issuerLockHash: EMPTY_ROOT }, { githubId: '1002' },
    { collectionId: `0x${'44'.repeat(20)}` }, { indexes: [2, 3] }]) {
    assert.throws(() => parseManifestEnvelope(manifest.outputType, { ...binding, ...overrides }), /trusted binding/);
  }
  const encode = envelope => hex(Buffer.from(JSON.stringify(envelope)));
  assert.throws(() => parseManifestEnvelope(encode({ ...manifest.envelope, protocol: 'unknown' }), binding), /protocol/);
  assert.throws(() => parseManifestEnvelope(encode({ ...manifest.envelope, manifestRoot: EMPTY_ROOT }), binding), /declared root/);
  const badKey = structuredClone(manifest.envelope);
  badKey.records[0].key = EMPTY_ROOT;
  assert.throws(() => parseManifestEnvelope(encode(badKey), binding), /record key/);
  const wrongOwner = structuredClone(manifest.envelope);
  wrongOwner.records.find(entry => entry.record.kind === 'developer').record.walletLockHash = EMPTY_ROOT;
  assert.throws(() => parseManifestEnvelope(encode(wrongOwner), binding), /verified owner/);
  assert.throws(() => parseManifestEnvelope(encode({ ...manifest.envelope, extra: true }), binding), /fields/);
  assert.throws(() => parseManifestEnvelope(hex(Buffer.from(JSON.stringify(manifest.envelope, null, 2))), binding), /canonically/);
});

test('compiled SMT proof evaluation matches the published CoTA subkey vector and independent wallet reconstruction', () => {
  const official = { key: '0xff007375626b6579000000020000000000000000000000000000000000000000',
    value: '0x00018c886cc799ff56cc8518ec5212116ffab98d33dd000000000000000000ff' };
  assert.equal(rootFromCotaProof([official], '0x4c4f00'), '0xd998d4a2bf50d0e9cdc42cbd689ff5d4f3afdcfedd4f0484bd8b3685c5ec6f95');
  const leaves = [{ key: EMPTY_ROOT, value: `0x${'11'.repeat(32)}` },
    { key: `0x01${'00'.repeat(31)}`, value: `0x${'22'.repeat(32)}` }];
  const proof = `0x4c50${leaves[1].value.slice(2)}4fff`;
  assert.equal(rootFromCotaProof([leaves[0]], proof), buildSmt(leaves).root);
  const unknown = updateFixture(true);
  assert.equal(rootFromCotaProof(unknown.oldLeaves, unknown.proof), unknown.previousCotaRoot);
  assert.equal(rootFromCotaProof([...unknown.newLeaves].reverse(), unknown.proof), unknown.cotaRoot);
  assert.notEqual(unknown.cotaRoot, buildSmt(unknown.newLeaves).root, 'The hidden wallet entry is preserved.');
  for (const malformed of ['0x', '0x4c', '0x4c50', '0x4c51', '0x4c4f', '0x4c4f004f01', '0x484f00', '0x4c4f00ff', '0x4c4c4f00']) {
    assert.throws(() => rootFromCotaProof([official], malformed), /compiled CoTA/);
  }
  assert.throws(() => rootFromCotaProof([official, official], '0x4c4f00'), /Duplicate/);
});

test('standard atomic update binds both metadata tokens, signed envelope and both CoTA roots', () => {
  const fixture = updateFixture(true);
  const validated = verifyManifestUpdate(fixture, binding);
  assert.equal(validated.root, fixture.manifest.root);
  assert.deepEqual(validated.newLeaves, fixture.newLeaves);
  assert.throws(() => verifyManifestUpdate({ ...fixture, previousCotaRoot: EMPTY_ROOT }, binding), /input and output roots/);
  assert.throws(() => verifyManifestUpdate({ ...fixture, cotaRoot: EMPTY_ROOT }, binding), /input and output roots/);
  const changed = structuredClone(fixture.newLeaves);
  const value = bytes(changed[0].value); value[2] ^= 1; changed[0].value = hex(value);
  const coherentChange = { ...fixture, inputType: updateWitness(fixture.oldLeaves, changed, fixture.proof) };
  assert.throws(() => verifyManifestUpdate(coherentChange, binding), /shards do not match/);
  const padded = structuredClone(fixture.newLeaves);
  const second = bytes(padded[1].value); second[21] = 1; padded[1].value = hex(second);
  assert.throws(() => parseManifestUpdate(updateWitness(fixture.oldLeaves, padded, fixture.proof), binding), /padding/);
});

test('standard witness parser rejects foreign assets, unsafe policy, state changes and malformed Molecule data', () => {
  const fixture = updateFixture();
  const input = (changes) => updateWitness(fixture.oldLeaves, fixture.newLeaves, fixture.proof, changes);
  const foreign = manifestTokenKeys(`0x${'55'.repeat(20)}`, binding.indexes).map(bytes);
  assert.throws(() => parseManifestUpdate(input({ 0: vector(foreign) }), binding), /different token pair/);
  const values = fixture.newLeaves.map(leaf => bytes(leaf.value).subarray(0, 22));
  for (const mutation of [value => { value[0] = 0; }, value => { value[1] = 1; }]) {
    const changed = values.map(value => Buffer.from(value)); mutation(changed[0]);
    assert.throws(() => parseManifestUpdate(input({ 2: vector(changed) }), binding), /configuration or state/);
  }
  assert.throws(() => parseManifestUpdate(input({ 4: moleculeBytes(Buffer.from('anything')) }), binding), /action/);
  assert.throws(() => parseManifestUpdate(`0x04${fixture.inputType.slice(4)}`, binding), /standard CoTA update/);
  assert.throws(() => parseManifestUpdate(input({ 2: vector(values.slice(0, 1)) }), binding), /vector/);
  assert.throws(() => parseManifestUpdate(`${fixture.inputType}00`, binding), /table/);
  assert.throws(() => readMoleculeTable(Buffer.alloc(4), 5), /table/);
  assert.throws(() => readMoleculeTable(Buffer.from('180000001800000010000000180000001800000018000000', 'hex'), 5), /offsets/);
  assert.throws(() => readFixedVector(Buffer.from('ffffffff', 'hex'), 22), /vector/);
  assert.throws(() => readMoleculeBytes(Buffer.from('01000000', 'hex')), /byte vector/);
});
