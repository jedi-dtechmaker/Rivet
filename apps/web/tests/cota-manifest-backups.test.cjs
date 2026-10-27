const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { reconcileManifestBackups } = require('../src/lib/cota-manifest-backups.ts');

function fixture(overrides = {}) {
  const lock = { codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: '0x1234' };
  const transaction = ccc.Transaction.from({ outputs: [{ lock, capacity: ccc.fixedPointFrom(100) }], outputsData: [`0x${'22'.repeat(32)}`] });
  const repo = { id: 'repo', userId: 'user', fullName: 'developer/project', isPrivate: false, isBackedUp: true,
    githubNumericId: null, ckbCellOutpoint: null, ckbTxHash: transaction.hash(), lastBackupCid: 'bafy-original', commitCount: 3,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-02-01'), ...overrides };
  const writes = [];
  const options = {
    database: { repository: { updateMany: async input => { writes.push(input); return { count: 1 }; } } },
    client: { getTransaction: async () => ({ status: 'committed', transaction }) },
    readRepository: async () => ({ ok: true, repository: { id: 2001, full_name: repo.fullName, owner: { id: 1001 }, created_at: '2025-01-01T00:00:00Z' } }),
  };
  return { repo, transaction, options, writes, run: () => reconcileManifestBackups({ id: 'user', githubId: '1001' }, [repo], options) };
}

test('existing public backups recover immutable identity and a unique confirmed anchor without another backup', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].data, { githubNumericId: '2001', ckbCellOutpoint: `${f.transaction.hash()}:0`, updatedAt: f.repo.updatedAt });
  assert.equal(f.writes[0].where.lastBackupCid, 'bafy-original');
  assert.equal(f.writes[0].where.userId, 'user');
  assert.equal(f.writes[0].where.githubNumericId, null);
  assert.equal(f.writes[0].where.updatedAt, f.repo.updatedAt);
});

test('complete metadata requires no reconciliation or external requests', async () => {
  const f = fixture({ githubNumericId: '2001', ckbCellOutpoint: `0x${'33'.repeat(32)}:0` });
  f.options.client.getTransaction = async () => assert.fail('Unexpected RPC');
  f.options.readRepository = async () => assert.fail('Unexpected GitHub request');
  await f.run();
  assert.equal(f.writes.length, 0);
});

test('legacy migration rejects another owner, recreated repositories, and unknown creation dates', async t => {
  for (const changed of [{ owner: { id: 9999 } }, { created_at: '2026-01-02T00:00:00Z' }, { created_at: undefined }]) {
    await t.test(JSON.stringify(changed), async () => {
      const f = fixture();
      const current = await f.options.readRepository();
      f.options.readRepository = async () => ({ ...current, repository: { ...current.repository, ...changed } });
      await assert.rejects(f.run, /historical repository identity/);
      assert.equal(f.writes.length, 0);
    });
  }
});

test('migration never guesses between multiple anchor outputs or trusts an unconfirmed/wrong transaction', async t => {
  await t.test('ambiguous output', async () => {
    const f = fixture();
    f.transaction.outputs.push(f.transaction.outputs[0].clone());
    f.transaction.outputsData.push(`0x${'44'.repeat(32)}`);
    f.repo.ckbTxHash = f.transaction.hash();
    await assert.rejects(f.run, /unambiguous/);
    assert.equal(f.writes.length, 0);
  });
  for (const status of ['pending', 'committed']) await t.test(status, async () => {
    const f = fixture();
    f.options.client.getTransaction = async () => ({ status, transaction: ccc.Transaction.from({}) });
    await assert.rejects(f.run, /could not be confirmed/);
    assert.equal(f.writes.length, 0);
  });
});

test('changed backup records cannot be overwritten by a stale metadata recovery', async () => {
  const f = fixture();
  f.options.database.repository.updateMany = async () => ({ count: 0 });
  await assert.rejects(f.run, /changed during metadata recovery/);
});

test('migration rejects foreign/private records and invalid saved anchor indexes', async () => {
  for (const change of [{ userId: 'another-user' }, { isPrivate: true }, { ckbCellOutpoint: `0x${'77'.repeat(32)}:0` }]) {
    const f = fixture(change);
    await assert.rejects(f.run, /not an eligible|anchor output is invalid/);
    assert.equal(f.writes.length, 0);
  }
});
