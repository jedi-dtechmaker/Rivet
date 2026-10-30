const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ccc } = require('@ckb-ccc/core');
const { getSporeScriptInfo } = require('@ckb-ccc/spore');
const { packRawSporeData } = require('@ckb-ccc/spore/advanced');
const { passportContent, PASSPORT_CONTENT_TYPE, verifyPassportOutput, validatePassportSignature } = require('../src/lib/passport.ts');
async function fixture() {
  const client = new ccc.ClientPublicTestnet();
  const owner = (await ccc.Address.fromKnownScript(client, ccc.KnownScript.JoyId, `0x0001${'11'.repeat(20)}`)).script;
  const proof = { binding: { githubId: '1001', ownerLockHash: owner.hash() }, manifestRoot: `0x${'ab'.repeat(32)}`, manifestTxHash: `0x${'cd'.repeat(32)}` };
  const content = passportContent('1001', 'developer', proof);
  const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: `0x${'33'.repeat(32)}`, index: 0 },
    cellOutput: { lock: owner, capacity: ccc.fixedPointFrom(2000) }, outputData: '0x' }] });
  const id = ccc.hashTypeId(tx.inputs[0], 0);
  tx.addOutput({ lock: owner, type: { ...getSporeScriptInfo(client), args: id } }, packRawSporeData({ contentType: PASSPORT_CONTENT_TYPE, content: new TextEncoder().encode(content) }));
  tx.setWitnessArgs(0, { lock: '0x0000' }); tx.setWitness(1, '0x112233');
  return { client, owner, proof, content, tx, id };
}
test('passport stores the verified identity snapshot under the connected JoyID lock and official Spore type', async () => {
  const f = await fixture();
  verifyPassportOutput(f.tx, f.owner, f.content, f.id, f.client);
  assert.throws(() => passportContent('9999', 'attacker', f.proof));
  const altered = f.tx.clone(); altered.outputs[0].lock.args = '0x9999';
  assert.throws(() => verifyPassportOutput(altered, f.owner, f.content, f.id, f.client));
  const changed = f.tx.clone(); changed.outputsData[0] = ccc.hexFrom(packRawSporeData({ contentType: 'application/json', content: new TextEncoder().encode('{}') }));
  assert.throws(() => verifyPassportOutput(changed, f.owner, f.content, f.id, f.client));
});
test('passport approvals preserve outputs, fees, deps and Spore cobuild bytes', async () => {
  const { tx } = await fixture();
  const signed = tx.clone(); signed.setWitnessArgs(0, { lock: '0xabcdef' });
  validatePassportSignature(tx, signed);
  for (const change of [value => value.outputs[0].capacity--, value => value.setWitness(1, '0x00'), value => value.setWitnessArgs(0, { lock: '0xabcd', outputType: '0x00' })]) {
    const modified = signed.clone(); change(modified); assert.throws(() => validatePassportSignature(tx, modified));
  }
});
test('reconnect and ambiguous submission retries preserve one saved passport and its exact transaction', async () => {
  const f = await fixture();
  const { prisma } = require('../src/lib/db.ts');
  const { preparePassport, submitPassport, getPassport } = require('../src/lib/passport-service.ts');
  const user = { id: 'passport-user', githubId: '1001', ckbAddress: ccc.Address.fromScript(f.owner, f.client).toString(), ckbAddressVerifiedAt: new Date() };
  let saved = { userId: user.id, ownerAddress: user.ckbAddress, status: 'prepared', content: f.content, sporeId: f.id,
    txHash: f.tx.hash(), unsignedTransaction: JSON.parse(f.tx.stringify()), signedTransaction: null, manifestRoot: f.proof.manifestRoot };
  let builds = 0, sends = [], committed = false;
  const original = { user: prisma.user.findUnique, find: prisma.sovereignPassport.findUnique,
    update: prisma.sovereignPassport.update, updateMany: prisma.sovereignPassport.updateMany, create: prisma.sovereignPassport.create };
  const wasEnabled = process.env.PASSPORT_ENABLED; process.env.PASSPORT_ENABLED = 'true';
  prisma.user.findUnique = async () => user;
  prisma.sovereignPassport.findUnique = async () => saved;
  prisma.sovereignPassport.create = async () => { builds++; throw new Error('Duplicate mint'); };
  prisma.sovereignPassport.updateMany = async ({ where, data }) => { if (where.status === saved.status) saved = { ...saved, ...data }; return { count: 1 }; };
  prisma.sovereignPassport.update = async ({ data }) => saved = { ...saved, ...data };
  f.client.sendTransactionDry = async () => 1n;
  f.client.getTransaction = async () => committed ? { status: 'committed', transaction: ccc.Transaction.from(saved.signedTransaction) } : undefined;
  f.client.sendTransaction = async tx => { sends.push(ccc.hexFrom(tx.toBytes())); if (sends.length === 1) throw new Error('Ambiguous timeout'); return tx.hash(); };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await preparePassport(user.githubId, f.client)).passport.sporeId, f.id);
    const signed = f.tx.clone(); signed.setWitnessArgs(0, { lock: '0xabcdef' });
    await assert.rejects(submitPassport(user.githubId, signed, f.client));
    assert.ok(saved.signedTransaction);
    await submitPassport(user.githubId, undefined, f.client);
    assert.equal(sends.length, 2); assert.equal(sends[0], sends[1]); assert.equal(builds, 0);
    committed = true;
    assert.equal((await getPassport(user.githubId, f.client)).passport.status, 'confirmed');
    await submitPassport(user.githubId, signed, f.client);
    assert.equal(sends.length, 2);
  } finally {
    prisma.user.findUnique = original.user; prisma.sovereignPassport.findUnique = original.find;
    prisma.sovereignPassport.update = original.update; prisma.sovereignPassport.updateMany = original.updateMany; prisma.sovereignPassport.create = original.create;
    if (wasEnabled === undefined) delete process.env.PASSPORT_ENABLED; else process.env.PASSPORT_ENABLED = wasEnabled;
  }
});
test('official Spore mint builder funds only the passport and wallet change using ordinary JoyID cells', async () => {
  const f = await fixture();
  const { buildPassportMint } = require('../src/lib/passport-chain.ts');
  const funding = [0, 1, 2].map(index => ccc.Cell.from({ outPoint: { txHash: `0x${'88'.repeat(32)}`, index },
    cellOutput: { lock: f.owner, capacity: ccc.fixedPointFrom(600) }, outputData: '0x' }));
  f.client.findCells = async function* () { yield* funding; };
  f.client.getCell = async point => funding.find(cell => cell.outPoint.eq(point));
  f.client.getCellDeps = async () => [{ outPoint: { txHash: `0x${'77'.repeat(32)}`, index: 0 }, depType: 'code' }];
  const { tx, id } = await buildPassportMint(f.owner, f.content, f.client);
  verifyPassportOutput(tx, f.owner, f.content, id, f.client);
  assert.ok(tx.inputs.length >= 2);
  assert.equal(tx.outputs.length, 2);
  assert.ok(tx.outputs[1].lock.eq(f.owner)); assert.equal(tx.outputs[1].type, undefined);
  const fee = await tx.getFee(f.client);
  assert.ok(fee > 0n && fee < ccc.fixedPointFrom('0.01'));
  assert.notEqual(tx.witnesses.at(-1), '0x');
  const protectedCell = funding[0].clone(); protectedCell.cellOutput.type = tx.outputs[0].type;
  f.client.findCells = async function* () { yield protectedCell; yield funding[1]; yield funding[2]; };
  f.client.getCell = async point => point.eq(protectedCell.outPoint) ? protectedCell : funding.find(cell => cell.outPoint.eq(point));
  await assert.rejects(buildPassportMint(f.owner, f.content, f.client), /ordinary wallet capacity/);
});
