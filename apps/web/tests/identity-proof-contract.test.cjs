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
const { createWitnessProofTransaction } = require('../src/lib/identity-proof.ts');
const { commitmentKey, commitmentValue, extensionUpdate } = require('../src/lib/cota-smt.ts');
const { createRecordsTransaction } = require('../src/lib/cota-records.ts');

test('the deployed JoyID and CoTA scripts accept signed proof anchoring and reject altered proofs', {
  skip: !process.env.RIVET_CKB_DEBUGGER || !process.env.RIVET_CKB_FIXTURE,
}, async () => {
  const fixture = JSON.parse(readFileSync(process.env.RIVET_CKB_FIXTURE, 'utf8'));
  const dependencies = fixture.tx.cell_deps.map(dependency => rpc.cellDepTo(dependency));
  const input = fixture.mock_info.inputs[0];
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const lock = ccc.Script.from({ ...rpc.scriptTo(input.output.lock), args: `0x0001${ccc.hashCkb(publicKey).slice(2, 42)}` });
  const cell = ccc.Cell.from({
    outPoint: { txHash: input.input.previous_output.tx_hash, index: input.input.previous_output.index },
    cellOutput: { ...rpc.cellOutputTo(input.output), lock, type: cotaTypeForLock(lock) }, outputData: input.data,
  });
  input.output = rpc.cellOutputFrom(cell.cellOutput);
  const records = [{ key: commitmentKey('developer'), record: { kind: 'developer', version: 1, githubId: 'generated-test-user', walletLockHash: lock.hash() } }];
  const transaction = createWitnessProofTransaction(cell, records, null).transaction;
  transaction.addCellDeps(dependencies);
  transaction.outputs[0].capacity -= 20000n;
  function signTransaction(unsigned) {
    const signed = unsigned.clone();
    const witness = signed.getWitnessArgs(0);
    const empty = ccc.WitnessArgs.from({ ...witness, lock: `0x${'00'.repeat(129)}` }).toBytes();
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(empty.length));
    const challenge = ccc.hashCkb(Buffer.concat([Buffer.from(signed.hash().slice(2), 'hex'), length, empty]));
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge.slice(2)).toString('base64url'), origin: 'https://testnet.joyid.dev', crossOrigin: false }));
    const authData = Buffer.alloc(37);
    createHash('sha256').update('testnet.joyid.dev').digest().copy(authData);
    authData[32] = 5;
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
    signed.setWitnessArgs(0, { ...witness, lock: ccc.hexFrom(Buffer.concat([Buffer.from([1]), publicKey, signature, authData, clientData])) });
    return signed;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'rivet-contract-test-'));
  const filename = path.join(directory, 'fixture.json');
  function execute(signed, script) {
    fixture.tx = rpc.transactionFrom(signed);
    writeFileSync(filename, JSON.stringify(fixture), { mode: 0o600 });
    const result = spawnSync(process.env.RIVET_CKB_DEBUGGER, ['--tx-file', filename, '--script', script], { encoding: 'utf8' });
    assert.ifError(result.error);
    const match = result.stdout.match(/Run result: (-?\d+)/);
    assert.ok(match, result.stderr || result.stdout);
    return Number(match[1]);
  }
  try {
    const signed = signTransaction(transaction);
    assert.equal(execute(signed, 'input.0.lock'), 0);
    assert.equal(execute(signed, 'input.0.type'), 0);
    const changed = signed.clone();
    changed.setWitnessArgs(0, { ...changed.getWitnessArgs(0), outputType: '0x1234' });
    assert.notEqual(execute(changed, 'input.0.lock'), 0);
    const changedRoot = transaction.clone();
    changedRoot.outputsData[0] = `0x02${'ab'.repeat(32)}`;
    assert.notEqual(execute(signTransaction(changedRoot), 'input.0.type'), 0);
    const extension = extensionUpdate([], records.map(entry => ({ key: entry.key, value: commitmentValue(entry.record) })), records);
    const legacy = createRecordsTransaction(cell, extension.root, extension.witness);
    legacy.addCellDeps(dependencies);
    assert.equal(execute(signTransaction(legacy), 'input.0.lock'), 16);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
