const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { JsonRpcTransformers: rpc } = require('@ckb-ccc/core/advanced');
const { cotaTypeForLock } = require('../src/lib/cota.ts');
const { buildSmt, commitmentKey, commitmentValue, EMPTY_ROOT } = require('../src/lib/cota-smt.ts');

const hex = buffer => `0x${buffer.toString('hex')}`;
const bytes = value => Buffer.from(value.slice(2), 'hex');
const uint32 = number => { const result = Buffer.alloc(4); result.writeUInt32LE(number); return result; };
const uint32be = number => { const result = Buffer.alloc(4); result.writeUInt32BE(number); return result; };
const vector = values => Buffer.concat([uint32(values.length), ...values]);
const moleculeBytes = value => Buffer.concat([uint32(value.length), value]);
function table(fields) {
  let offset = 4 * (fields.length + 1);
  const offsets = fields.map(field => { const current = offset; offset += field.length; return uint32(current); });
  return Buffer.concat([uint32(offset), ...offsets, ...fields]);
}

// Test-local partial proof generator. Unqueried leaves remain in the root and
// are carried as sibling hashes, rather than pretending the wallet tree is empty.
function partialTree(leaves, queried) {
  const sorted = leaves.map(leaf => ({ ...leaf,
    path: BigInt(`0x${Buffer.from(bytes(leaf.key)).reverse().toString('hex')}`),
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const keyBytes = number => Buffer.from(number.toString(16).padStart(64, '0'), 'hex').reverse();
  const hash = (...parts) => ccc.hashCkb(Buffer.concat(parts));
  const nodeHash = node => 'hash' in node ? node.hash
    : hash(Buffer.from([2]), bytes(node.base), keyBytes(node.bits), Buffer.from([node.count]));
  const zero = node => 'hash' in node && node.hash === EMPTY_ROOT;
  function merge(height, prefix, left, right) {
    if (zero(left) && zero(right)) return { hash: EMPTY_ROOT };
    if (zero(left) || zero(right)) {
      const child = zero(left) ? right : left;
      const bit = zero(left) ? 1n << BigInt(height) : 0n;
      return 'hash' in child
        ? { base: hash(Buffer.from([height]), keyBytes(prefix), bytes(child.hash)), bits: bit, count: 1 }
        : { base: child.base, bits: child.bits | bit, count: (child.count + 1) % 256 };
    }
    return { hash: hash(Buffer.from([1, height]), keyBytes(prefix), bytes(nodeHash(left)), bytes(nodeHash(right))) };
  }
  const proof = [];
  function walk(items, height, prefix) {
    if (!items.length) return { node: { hash: EMPTY_ROOT }, query: false };
    if (height < 0) {
      const query = queried.has(items[0].key);
      if (query) proof.push(0x4c);
      return { node: { hash: items[0].value }, query };
    }
    const bit = 1n << BigInt(height);
    const split = items.findIndex(item => (item.path & bit) !== 0n);
    const left = walk(split < 0 ? items : items.slice(0, split), height - 1, prefix);
    const right = walk(split < 0 ? [] : items.slice(split), height - 1, prefix | bit);
    if (left.query && right.query) proof.push(0x48);
    else if (left.query || right.query) {
      const sibling = left.query ? right.node : left.node;
      if (zero(sibling)) proof.push(0x4f, 1);
      else if ('hash' in sibling) proof.push(0x50, ...bytes(sibling.hash));
      else proof.push(0x51, sibling.count, ...bytes(sibling.base), ...keyBytes(sibling.bits));
    }
    return { node: merge(height, prefix, left.node, right.node), query: left.query || right.query };
  }
  return { root: nodeHash(walk(sorted, 255, 0n).node), proof: Buffer.from(proof) };
}

function readTable(buffer, fields) {
  assert.equal(buffer.readUInt32LE(0), buffer.length);
  assert.equal(buffer.readUInt32LE(4), 4 * (fields + 1));
  const offsets = Array.from({ length: fields }, (_, index) => buffer.readUInt32LE(4 * (index + 1)));
  return offsets.map((offset, index) => buffer.subarray(offset, offsets[index + 1] ?? buffer.length));
}

function readVector(buffer, itemLength) {
  const count = buffer.readUInt32LE(0);
  assert.equal(buffer.length, 4 + count * itemLength);
  return Array.from({ length: count }, (_, index) => buffer.subarray(4 + index * itemLength, 4 + (index + 1) * itemLength));
}

// Offline compatibility candidate only: the simulated input assumes TWO
// legitimately issued and already claimed metadata NFTs. This does not test
// definition, minting, claiming, real JoyID approval, or production publication.
test('two standard CoTA metadata slots can commit a full identity/backup manifest under JoyID', {
  skip: !process.env.RIVET_CKB_DEBUGGER || !process.env.RIVET_CKB_FIXTURE,
}, async context => {
  const fixture = JSON.parse(readFileSync(process.env.RIVET_CKB_FIXTURE, 'utf8'));
  const dependencies = fixture.tx.cell_deps.map(dependency => rpc.cellDepTo(dependency));
  const original = fixture.mock_info.inputs[0];
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const lock = ccc.Script.from({ ...rpc.scriptTo(original.output.lock), args: `0x0001${ccc.hashCkb(publicKey).slice(2, 42)}` });
  const collection = Buffer.from('c3'.repeat(20), 'hex');
  const nftKeys = [0, 1].map(index => Buffer.concat([Buffer.from('8101', 'hex'), collection, uint32be(index)]));
  const leafKeys = nftKeys.map(key => hex(Buffer.concat([key, Buffer.alloc(6)])));
  // configure 0xf7 permits characteristic updates (bit 3 is clear). State is 0.
  // The other restrictions do not establish bootstrap ownership by themselves.
  const heldInfo = characteristic => Buffer.concat([Buffer.from([0xf7, 0]), characteristic]);
  const leaf = (key, info) => ({ key, value: hex(Buffer.concat([info, Buffer.alloc(9), Buffer.from([255])])) });
  const oldValues = [heldInfo(Buffer.alloc(20, 1)), heldInfo(Buffer.alloc(20, 2))];
  const unchanged = Array.from({ length: 4 }, (_, index) => ({
    key: ccc.hashCkb(Buffer.from(`generated-other-wallet-leaf-${index}`)),
    value: ccc.hashCkb(Buffer.from(`generated-other-wallet-value-${index}`)),
  }));
  const records = [
    { key: commitmentKey('developer'), record: {
      kind: 'developer', version: 1, network: 'ckb-testnet', githubId: '1001', githubUsername: 'generated', walletLockHash: lock.hash(),
    } },
    { key: commitmentKey('backup:github-repository:2001'), record: {
      kind: 'backup', version: 1, network: 'ckb-testnet', repository: 'generated/testing',
      repositoryId: '2001', ipfsCid: 'bafy-generated-public-backup', merkleRoot: `0x${'ab'.repeat(32)}`,
      anchorOutpoint: `0x${'cd'.repeat(32)}:0`, commitCount: 3,
    } },
  ];
  const manifest = buildSmt(records.map(entry => ({ key: entry.key, value: commitmentValue(entry.record) })));
  const rootBytes = bytes(manifest.root);
  const newValues = [heldInfo(rootBytes.subarray(0, 20)), heldInfo(Buffer.concat([rootBytes.subarray(20), Buffer.alloc(8)]))];
  const envelope = {
    protocol: 'rivet-cota-manifest-v1', network: 'ckb-testnet', ownerLockHash: lock.hash(),
    collection: hex(collection), indexes: [0, 1], manifestRoot: manifest.root, records,
  };
  const queried = new Set(leafKeys);
  const oldLeaves = leafKeys.map((key, index) => leaf(key, oldValues[index]));
  const oldTree = partialTree([...oldLeaves, ...unchanged], queried);
  assert.equal(oldTree.root, buildSmt([...oldLeaves, ...unchanged]).root);
  const cell = ccc.Cell.from({
    outPoint: rpc.outPointTo(original.input.previous_output),
    cellOutput: { ...rpc.cellOutputTo(original.output), lock, type: cotaTypeForLock(lock) },
    outputData: `0x02${oldTree.root.slice(2)}`,
  });

  function transaction(values, extraLeaves = unchanged) {
    const changed = leafKeys.map((key, index) => leaf(key, values[index]));
    const tree = partialTree([...changed, ...extraLeaves], queried);
    assert.equal(tree.root, buildSmt([...changed, ...extraLeaves]).root);
    const entries = table([vector(nftKeys), vector(oldValues), vector(values), moleculeBytes(tree.proof),
      moleculeBytes(Buffer.from('Update NFT information'))]);
    const result = ccc.Transaction.from({
      inputs: [{ previousOutput: cell.outPoint, cellOutput: cell.cellOutput, outputData: cell.outputData }],
      outputs: [cell.cellOutput.clone()], outputsData: [`0x02${tree.root.slice(2)}`], cellDeps: dependencies,
    });
    result.outputs[0].capacity -= 30000n;
    result.setWitnessArgs(0, {
      inputType: hex(Buffer.concat([Buffer.from([5]), entries])), outputType: hex(Buffer.from(JSON.stringify(envelope))),
    });
    return result;
  }

  function signTransaction(unsigned) {
    const signed = unsigned.clone();
    const witness = signed.getWitnessArgs(0);
    const empty = ccc.WitnessArgs.from({ ...witness, lock: `0x${'00'.repeat(129)}` }).toBytes();
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(empty.length));
    const challenge = ccc.hashCkb(Buffer.concat([bytes(signed.hash()), length, empty]));
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get',
      challenge: Buffer.from(challenge.slice(2)).toString('base64url'), origin: 'https://testnet.joyid.dev', crossOrigin: false }));
    const authData = Buffer.alloc(37);
    createHash('sha256').update('testnet.joyid.dev').digest().copy(authData);
    authData[32] = 5;
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]),
      { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
    signed.setWitnessArgs(0, { ...witness, lock: hex(Buffer.concat([Buffer.from([1]), publicKey, signature, authData, clientData])) });
    return signed;
  }

  // Application binding is verified separately from CoTA's standard NFT rules.
  // Recompute canonical record hashes here without commitmentValue, and decode
  // the actual signed NFT update rather than trusting the construction values.
  function verifyManifestBinding(signed) {
    const witness = signed.getWitnessArgs(0);
    const declared = JSON.parse(bytes(witness.outputType).toString('utf8'));
    assert.equal(declared.protocol, 'rivet-cota-manifest-v1');
    assert.equal(declared.ownerLockHash, lock.hash());
    assert.equal(declared.collection, hex(collection));
    assert.deepEqual(declared.indexes, [0, 1]);
    const update = bytes(witness.inputType);
    assert.equal(update[0], 5);
    const fields = readTable(update.subarray(1), 5);
    assert.deepEqual(readVector(fields[0], 26), nftKeys);
    const values = readVector(fields[2], 22);
    values.forEach(value => assert.deepEqual(value.subarray(0, 2), Buffer.from([0xf7, 0])));
    assert.deepEqual(values[1].subarray(14), Buffer.alloc(8), 'The second shard padding is canonical.');
    const decodedRoot = hex(Buffer.concat([values[0].subarray(2), values[1].subarray(2, 14)]));
    assert.equal(decodedRoot, declared.manifestRoot, 'Metadata shards must match the signed manifest root.');
    const recordLeaves = declared.records.map(({ key, record }) => {
      const order = record.kind === 'developer'
        ? ['kind', 'version', 'network', 'githubId', 'githubUsername', 'walletLockHash']
        : ['kind', 'version', 'network', 'repository', 'ipfsCid', 'merkleRoot', 'anchorOutpoint', 'commitCount'];
      const fields = [...order.filter(name => name in record), ...Object.keys(record).filter(name => !order.includes(name)).sort()];
      const encoded = JSON.stringify(Object.fromEntries(fields.map(name => [name, record[name]])));
      return { key, value: ccc.hashCkb(Buffer.from(encoded)) };
    });
    const independentlyComputed = partialTree(recordLeaves, new Set(recordLeaves.map(entry => entry.key)));
    assert.equal(decodedRoot, independentlyComputed.root, 'The decoded root must commit the public identity and backup records.');
    const walletLeaves = leafKeys.map((key, index) => leaf(key, values[index]));
    assert.equal(signed.outputsData[0], `0x02${partialTree([...walletLeaves, ...unchanged], queried).root.slice(2)}`);
    return decodedRoot;
  }

  const directory = mkdtempSync(path.join(tmpdir(), 'rivet-manifest-contract-'));
  const filename = path.join(directory, 'fixture.json');
  function execute(signed, script) {
    const local = structuredClone(fixture);
    local.tx = rpc.transactionFrom(signed);
    local.mock_info.inputs = [{ input: local.tx.inputs[0], output: rpc.cellOutputFrom(cell.cellOutput), data: cell.outputData }];
    writeFileSync(filename, JSON.stringify(local), { mode: 0o600 });
    const result = spawnSync(process.env.RIVET_CKB_DEBUGGER, ['--tx-file', filename, '--script', script], { encoding: 'utf8' });
    assert.ifError(result.error);
    const match = result.stdout.match(/Run result: (-?\d+)/);
    assert.ok(match, result.stderr || result.stdout);
    return Number(match[1]);
  }

  try {
    const unsigned = transaction(newValues);
    const approved = signTransaction(unsigned);
    await context.test('both deployed scripts accept the atomic pair update and signed public manifest', () => {
      assert.equal(verifyManifestBinding(approved), manifest.root);
      assert.equal(execute(approved, 'input.0.lock'), 0);
      assert.equal(execute(approved, 'input.0.type'), 0);
    });
    await context.test('a proof includes unrelated wallet state, and omitting it is rejected', () => {
      const incomplete = signTransaction(transaction(newValues, []));
      assert.equal(execute(incomplete, 'input.0.lock'), 0);
      assert.notEqual(execute(incomplete, 'input.0.type'), 0);
    });
    await context.test('changing the public envelope after approval is rejected by JoyID', () => {
      const changed = approved.clone();
      const witness = changed.getWitnessArgs(0);
      changed.setWitnessArgs(0, { ...witness, outputType: hex(Buffer.from(JSON.stringify({ ...envelope, manifestRoot: EMPTY_ROOT }))) });
      assert.equal(execute(changed, 'input.0.type'), 0);
      assert.notEqual(execute(changed, 'input.0.lock'), 0);
    });
    await context.test('a signed incorrect CoTA root is rejected by the CoTA type', () => {
      const changed = unsigned.clone();
      changed.outputsData[0] = `0x02${'ab'.repeat(32)}`;
      const signed = signTransaction(changed);
      assert.equal(execute(signed, 'input.0.lock'), 0);
      assert.notEqual(execute(signed, 'input.0.type'), 0);
    });
    await context.test('a coherently signed shard change still fails application manifest verification', () => {
      const changedValues = newValues.map(value => Buffer.from(value));
      changedValues[0][2] ^= 1;
      const changed = signTransaction(transaction(changedValues));
      assert.equal(execute(changed, 'input.0.lock'), 0);
      assert.equal(execute(changed, 'input.0.type'), 0);
      assert.throws(() => verifyManifestBinding(changed), /Metadata shards must match the signed manifest root/);
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
