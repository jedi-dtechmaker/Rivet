const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { buildSmt, EMPTY_ROOT, commitmentKey, commitmentValue, extensionUpdate } = require('../src/lib/cota-smt.ts');
const { createRecordsTransaction, validateSignedUpdate } = require('../src/lib/cota-records.ts');
const { COTA_TESTNET, cotaTypeForLock } = require('../src/lib/cota.ts');

test('SMT hashing matches the published CoTA subkey vector byte for byte', () => {
  const leaf = {
    key: '0xff007375626b6579000000020000000000000000000000000000000000000000',
    value: '0x00018c886cc799ff56cc8518ec5212116ffab98d33dd000000000000000000ff',
  };
  assert.equal(buildSmt([leaf]).root, '0xd998d4a2bf50d0e9cdc42cbd689ff5d4f3afdcfedd4f0484bd8b3685c5ec6f95');
  assert.equal(buildSmt([]).root, EMPTY_ROOT);
});

test('identity and backup leaves share a deterministic root in a separate namespace from JoyID keys', () => {
  const leaves = ['developer', 'backup:owner/repo'].map(name => ({ key: commitmentKey(name), value: commitmentValue({ name }) }));
  assert.equal(buildSmt(leaves).root, buildSmt([...leaves].reverse()).root);
  assert.notEqual(buildSmt(leaves).root, buildSmt(leaves.slice(0, 1)).root);
  assert.ok(leaves.every(leaf => leaf.key.startsWith('0xff00726976657431')));
  assert.notEqual(commitmentValue({ name: 'owner/repo', cid: 'first' }), commitmentValue({ name: 'owner/repo', cid: 'second' }));
  const developer = { kind: 'developer', version: 1, network: 'ckb-testnet', githubId: '123', githubUsername: 'tester', walletLockHash: EMPTY_ROOT };
  assert.equal(commitmentValue(developer), commitmentValue(Object.fromEntries(Object.entries(developer).reverse())));
  const backup = { kind: 'backup', version: 1, network: 'ckb-testnet', repository: 'owner/testing', ipfsCid: 'cid', merkleRoot: EMPTY_ROOT, anchorOutpoint: 'outpoint', commitCount: 7 };
  assert.equal(commitmentValue(backup), commitmentValue(Object.fromEntries(Object.entries(backup).reverse())));
});

test('extension updates bind the old and new tree and reject missing or foreign leaves', () => {
  const first = { key: commitmentKey('developer'), value: commitmentValue({ githubId: '123' }) };
  const backup = { key: commitmentKey('backup:owner/repo'), value: commitmentValue({ tx: 'confirmed' }) };
  const added = extensionUpdate([], [first, backup], []);
  assert.equal(added.previousRoot, EMPTY_ROOT);
  assert.equal(added.root, buildSmt([first, backup]).root);
  assert.ok(added.witness.startsWith('0xf1'));
  const changed = { ...backup, value: commitmentValue({ tx: 'new-confirmed' }) };
  const updated = extensionUpdate([first, backup], [first, changed], []);
  assert.equal(updated.previousRoot, added.root);
  assert.notEqual(updated.root, added.root);
  assert.throws(() => extensionUpdate([first, backup], [first], []), /Removing existing/);
  assert.throws(() => extensionUpdate([], [{ key: EMPTY_ROOT, value: first.value }], []), /Invalid Rivet/);
  assert.throws(() => buildSmt([first, first]), /Duplicate/);
});

test('a prepared update consumes the existing CoTA cell and preserves its wallet lock and type', () => {
  const lock = ccc.Script.from({ codeHash: `0x${'12'.repeat(32)}`, hashType: 'type', args: `0x${'34'.repeat(22)}` });
  const cell = ccc.Cell.from({
    outPoint: { txHash: `0x${'56'.repeat(32)}`, index: 1 },
    cellOutput: { lock, type: cotaTypeForLock(lock), capacity: ccc.fixedPointFrom(150) }, outputData: `0x02${EMPTY_ROOT.slice(2)}`,
  });
  const leaf = { key: commitmentKey('developer'), value: commitmentValue({ githubId: '123' }) };
  const update = extensionUpdate([], [leaf], []);
  const transaction = createRecordsTransaction(cell, update.root, update.witness);
  assert.equal(transaction.inputs.length, 1);
  assert.equal(transaction.outputs.length, 1);
  assert.ok(transaction.inputs[0].previousOutput.eq(cell.outPoint));
  assert.ok(transaction.outputs[0].lock.eq(lock));
  assert.ok(transaction.outputs[0].type.eq(cotaTypeForLock(lock)));
  assert.equal(transaction.outputsData[0], `0x02${update.root.slice(2)}`);
  assert.equal(transaction.getWitnessArgs(0).inputType, update.witness);
  assert.equal(transaction.cellDeps[0].outPoint.txHash, COTA_TESTNET.cellDeps[0].outPoint.txHash);
  const signed = transaction.clone();
  signed.setWitnessArgs(0, { ...signed.getWitnessArgs(0), lock: '0x1234' });
  assert.doesNotThrow(() => validateSignedUpdate(transaction, signed));
  const tampered = signed.clone();
  tampered.outputs[0].capacity -= 1n;
  assert.throws(() => validateSignedUpdate(transaction, tampered), /differs/);
  const changedProof = signed.clone();
  changedProof.setWitnessArgs(0, { ...changedProof.getWitnessArgs(0), inputType: '0xf1' });
  assert.throws(() => validateSignedUpdate(transaction, changedProof), /differs/);
});
