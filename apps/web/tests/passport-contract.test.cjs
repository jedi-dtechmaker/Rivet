const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash, sign } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { ccc } = require('@ckb-ccc/core');
const { JsonRpcTransformers: rpc } = require('@ckb-ccc/core/advanced');
const { buildPassportMint } = require('../src/lib/passport-chain.ts');
const { passportContent, verifyPassportOutput, validatePassportSignature } = require('../src/lib/passport.ts');
const bytes = hex => Buffer.from(hex.slice(2), 'hex');
const hex = buffer => `0x${buffer.toString('hex')}`;
test('production passport mint passes deployed JoyID and Spore scripts with a generated passkey', {
  skip: !process.env.RIVET_CKB_DEBUGGER || !process.env.RIVET_PASSPORT_FIXTURE,
}, async context => {
  const fixture = JSON.parse(readFileSync(process.env.RIVET_PASSPORT_FIXTURE, 'utf8'));
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const source = fixture.mock_info.inputs[0], client = new ccc.ClientPublicTestnet();
  const owner = ccc.Script.from({ ...rpc.scriptTo(source.output.lock), args: `0x0001${ccc.hashCkb(publicKey).slice(2, 42)}` });
  const funding = ccc.Cell.from({ outPoint: rpc.outPointTo(source.input.previous_output), cellOutput: { lock: owner, capacity: ccc.fixedPointFrom(2000) }, outputData: '0x' });
  client.findCells = async function* () { yield funding; };
  client.getCell = async () => funding;
  client.getCellDeps = async () => fixture.tx.cell_deps.map(rpc.cellDepTo);
  const content = passportContent('1001', 'generated-developer', { binding: { githubId: '1001', ownerLockHash: owner.hash() }, manifestRoot: `0x${'ab'.repeat(32)}`, manifestTxHash: `0x${'cd'.repeat(32)}` });
  const { tx, id } = await buildPassportMint(owner, content, client);
  function approve(unsigned) {
    const signed = unsigned.clone();
    const empty = ccc.WitnessArgs.from({ ...signed.getWitnessArgs(0), lock: `0x${'00'.repeat(129)}` }).toBytes();
    const packed = value => { const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(value.length)); return Buffer.concat([length, value]); };
    const challenge = ccc.hashCkb(Buffer.concat([bytes(signed.hash()), packed(empty), ...signed.witnesses.slice(signed.inputs.length).map(value => packed(bytes(value)))]));
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge.slice(2)).toString('base64url'), origin: 'https://testnet.joyid.dev', crossOrigin: false }));
    const authData = Buffer.alloc(37); createHash('sha256').update('testnet.joyid.dev').digest().copy(authData); authData[32] = 5;
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
    signed.setWitnessArgs(0, { lock: hex(Buffer.concat([Buffer.from([1]), publicKey, signature, authData, clientData])) });
    return signed;
  }
  const directory = mkdtempSync(join(tmpdir(), 'rivet-passport-contract-')), filename = join(directory, 'fixture.json');
  function execute(tx, script) {
    const local = structuredClone(fixture); local.tx = rpc.transactionFrom(tx);
    local.mock_info.inputs = [{ input: local.tx.inputs[0], output: rpc.cellOutputFrom(funding.cellOutput), data: '0x' }];
    writeFileSync(filename, JSON.stringify(local), { mode: 0o600 });
    const result = spawnSync(process.env.RIVET_CKB_DEBUGGER, ['--tx-file', filename, '--script', script], { encoding: 'utf8' });
    assert.ifError(result.error);
    const match = result.stdout.match(/Run result: (-?\d+)/); assert.ok(match, result.stderr || result.stdout);
    return Number(match[1]);
  }
  try {
    const approved = approve(tx);
    await context.test('actual builder and generated approval pass both scripts', () => {
      verifyPassportOutput(approved, owner, content, id, client); validatePassportSignature(tx, approved);
      assert.equal(execute(approved, 'input.0.lock'), 0); assert.equal(execute(approved, 'output.0.type'), 0);
    });
    await context.test('changing passport content invalidates the Spore cobuild action', () => {
      const changed = tx.clone(); changed.outputsData[0] = changed.outputsData[0].slice(0, -2) + '20';
      const signed = approve(changed);
      assert.equal(execute(signed, 'input.0.lock'), 0); assert.notEqual(execute(signed, 'output.0.type'), 0);
    });
    await context.test('changing the approved output without new approval fails JoyID', () => {
      const changed = approved.clone(); changed.outputs[0].capacity++;
      assert.notEqual(execute(changed, 'input.0.lock'), 0);
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
