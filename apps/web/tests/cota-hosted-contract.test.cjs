const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { JsonRpcTransformers: rpc } = require('@ckb-ccc/core/advanced');
const { cotaTypeForLock } = require('../src/lib/cota.ts');
const { commitmentKey, commitmentValue, EMPTY_ROOT, extensionUpdate } = require('../src/lib/cota-smt.ts');
const { createRecordsTransaction } = require('../src/lib/cota-records.ts');

// Candidate hosted record tree only. These generated keys and simulated inputs
// do not exercise user-owned JoyID onboarding, migration, or live sponsorship.
test('a generated secp owner can initialize and update a multi-user CoTA application tree', {
  skip: !process.env.RIVET_CKB_DEBUGGER || !process.env.RIVET_CKB_FIXTURE,
}, async context => {
  const fixture = JSON.parse(readFileSync(process.env.RIVET_CKB_FIXTURE, 'utf8'));
  // Static deployment information only: this client never makes RPC requests.
  const client = new ccc.ClientPublicTestnet();
  const script = await client.getKnownScript(ccc.KnownScript.Secp256k1Blake160);
  const secpDependency = script.cellDeps[0].cellDep;
  const dependencies = fixture.tx.cell_deps.map(dependency => rpc.cellDepTo(dependency));
  assert.ok(dependencies.some(dependency => ccc.CellDep.from(dependency).eq(secpDependency)),
    'The public fixture must include secp256k1 dependencies; generate it with cota:fixture --include-secp.');
  const signer = new ccc.SignerCkbPrivateKey(client, randomBytes(32));
  const owner = (await signer.getRecommendedAddressObj()).script;
  const original = fixture.mock_info.inputs[0];
  const initialCell = ccc.Cell.from({
    outPoint: rpc.outPointTo(original.input.previous_output),
    cellOutput: { ...rpc.cellOutputTo(original.output), lock: owner, type: cotaTypeForLock(owner) },
    outputData: `0x02${EMPTY_ROOT.slice(2)}`,
  });

  function leaf(githubId, name, record) {
    return { key: commitmentKey(`github:${githubId}:${name}`), value: commitmentValue(record) };
  }
  const alice = { kind: 'developer', version: 1, githubId: '1001', githubUsername: 'alice' };
  const bob = { kind: 'developer', version: 1, githubId: '1002', githubUsername: 'bob' };
  const aliceBackup = { kind: 'backup', version: 1, repository: 'alice/project', merkleRoot: `0x${'12'.repeat(32)}` };
  const bobBackup = { kind: 'backup', version: 1, repository: 'bob/project', merkleRoot: `0x${'34'.repeat(32)}` };
  const before = [leaf(alice.githubId, 'developer', alice), leaf(alice.githubId, 'backup:project', aliceBackup),
    leaf(bob.githubId, 'developer', bob), leaf(bob.githubId, 'backup:project', bobBackup)];
  const initialize = extensionUpdate([], before, [alice, aliceBackup, bob, bobBackup]);

  function transaction(cell, update) {
    const result = createRecordsTransaction(cell, update.root, update.witness);
    result.addCellDeps(dependencies);
    result.outputs[0].capacity -= 20000n;
    return result;
  }

  function sign(unsigned) {
    const signed = unsigned.clone();
    const witness = signed.getWitnessArgs(0);
    const empty = ccc.WitnessArgs.from({ ...witness, lock: `0x${'00'.repeat(65)}` }).toBytes();
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(empty.length));
    const sighash = ccc.hashCkb(Buffer.concat([Buffer.from(signed.hash().slice(2), 'hex'), length, empty]));
    signed.setWitnessArgs(0, { ...witness, lock: ccc.signMessageSecp256k1(sighash, signer.privateKey) });
    return signed;
  }

  const directory = mkdtempSync(path.join(tmpdir(), 'rivet-hosted-cota-contract-'));
  const filename = path.join(directory, 'fixture.json');
  function execute(signed, input, scriptName) {
    const local = structuredClone(fixture);
    local.tx = rpc.transactionFrom(signed);
    local.mock_info.inputs = [{
      input: local.tx.inputs[0], output: rpc.cellOutputFrom(input.cellOutput), data: input.outputData,
    }];
    writeFileSync(filename, JSON.stringify(local), { mode: 0o600 });
    const result = spawnSync(process.env.RIVET_CKB_DEBUGGER,
      ['--tx-file', filename, '--script', scriptName], { encoding: 'utf8' });
    assert.ifError(result.error);
    const match = result.stdout.match(/Run result: (-?\d+)/);
    assert.ok(match, result.stderr || result.stdout);
    return Number(match[1]);
  }

  try {
    const first = sign(transaction(initialCell, initialize));
    await context.test('initial custom records pass the deployed CoTA type and secp lock', () => {
      assert.equal(initialize.previousRoot, EMPTY_ROOT);
      assert.equal(execute(first, initialCell, 'input.0.type'), 0);
      assert.equal(execute(first, initialCell, 'input.0.lock'), 0);
    });
    const nextCell = ccc.Cell.from({
      outPoint: { txHash: first.hash(), index: 0 }, cellOutput: first.outputs[0], outputData: first.outputsData[0],
    });
    const renamedAlice = { ...alice, githubUsername: 'alice-renamed' };
    const newerBackup = { ...aliceBackup, repository: 'alice-renamed/project', merkleRoot: `0x${'56'.repeat(32)}` };
    const after = [leaf(alice.githubId, 'developer', renamedAlice), leaf(alice.githubId, 'backup:project', newerBackup),
      before[2], before[3]];
    const update = extensionUpdate(before, after, [renamedAlice, newerBackup, bob, bobBackup]);
    const unsigned = transaction(nextCell, update);
    const approved = sign(unsigned);
    await context.test('a later update uses immutable GitHub ID namespaces and retains the other user', () => {
      assert.equal(after[0].key, before[0].key);
      assert.equal(after[1].key, before[1].key);
      assert.notEqual(after[0].key, after[2].key);
      assert.notEqual(after[1].key, after[3].key);
      assert.deepEqual(update.leaves.filter(entry => [before[2].key, before[3].key].includes(entry.key))
        .sort((left, right) => left.key.localeCompare(right.key)),
      before.slice(2).sort((left, right) => left.key.localeCompare(right.key)));
      assert.equal(update.previousRoot, initialize.root);
      assert.notEqual(update.root, initialize.root);
      assert.equal(execute(approved, nextCell, 'input.0.type'), 0);
      assert.equal(execute(approved, nextCell, 'input.0.lock'), 0);
    });
    await context.test('the CoTA type rejects an incorrect root even with a valid owner signature', () => {
      const changed = unsigned.clone();
      changed.outputsData[0] = `0x02${'ab'.repeat(32)}`;
      const signed = sign(changed);
      assert.equal(execute(signed, nextCell, 'input.0.lock'), 0);
      assert.notEqual(execute(signed, nextCell, 'input.0.type'), 0);
    });
    await context.test('the owner lock rejects a corrupted signature on a valid CoTA update', () => {
      const changed = approved.clone();
      const witness = changed.getWitnessArgs(0);
      const signature = Buffer.from(witness.lock.slice(2), 'hex');
      signature[0] ^= 1;
      changed.setWitnessArgs(0, { ...witness, lock: ccc.hexFrom(signature) });
      assert.equal(execute(changed, nextCell, 'input.0.type'), 0);
      assert.notEqual(execute(changed, nextCell, 'input.0.lock'), 0);
    });
    await context.test('a proof that omits the other user cannot match the previous on-chain root', () => {
      const incomplete = extensionUpdate(before.slice(0, 2), after.slice(0, 2), [renamedAlice, newerBackup]);
      const signed = sign(transaction(nextCell, incomplete));
      assert.equal(execute(signed, nextCell, 'input.0.lock'), 0);
      assert.notEqual(execute(signed, nextCell, 'input.0.type'), 0);
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
