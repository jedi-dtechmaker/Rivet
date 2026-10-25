const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Prisma } = require('@prisma/client');
const { db, prisma, databaseConnectionUrl } = require('../src/lib/db.ts');
const DashboardError = require('../src/app/dashboard/error.tsx').default;

const restorations = [];

afterEach(() => {
  while (restorations.length) restorations.pop()();
});

function mockModel(model, method, implementation) {
  const original = model[method];
  model[method] = mock.fn(implementation);
  restorations.push(() => { model[method] = original; });
  return model[method];
}

function unavailable() {
  return new Prisma.PrismaClientInitializationError('Database endpoint unavailable', '5.14.0', 'P1001');
}

test('database connections allow a slow startup without changing credentials or other URL settings', () => {
  const url = new URL(databaseConnectionUrl('postgresql://example_user:example_password@localhost:5432/proofs?schema=test_schema&sslmode=require'));
  assert.equal(url.searchParams.get('connect_timeout'), '15');
  assert.equal(url.searchParams.get('pool_timeout'), '15');
  assert.equal(url.username, 'example_user');
  assert.equal(url.password, 'example_password');
  assert.equal(url.searchParams.get('schema'), 'test_schema');
  assert.equal(url.searchParams.get('sslmode'), 'require');
});

test('explicit database connection and pool settings keep their configured values', () => {
  const url = new URL(databaseConnectionUrl('postgresql://localhost/proofs?connect_timeout=4&pool_timeout=30&connection_limit=2'));
  assert.equal(url.searchParams.get('connect_timeout'), '4');
  assert.equal(url.searchParams.get('pool_timeout'), '30');
  assert.equal(url.searchParams.get('connection_limit'), '2');
});

test('a transient database connection failure retries the same user lookup once', async () => {
  let attempts = 0;
  const query = mockModel(prisma.user, 'findUnique', async options => {
    assert.deepEqual(options.where, { githubId: 'github-user' });
    attempts += 1;
    if (attempts === 1) throw unavailable();
    return { id: 'saved-user' };
  });
  assert.deepEqual(await db.findUserByGithubId('github-user'), { id: 'saved-user' });
  assert.equal(query.mock.callCount(), 2);
});

test('a transient connection failure preserves saved backup state after retry', async () => {
  let attempts = 0;
  const saved = [{ fullName: 'owner/testing', isBackedUp: true }];
  const query = mockModel(prisma.repository, 'findMany', async options => {
    assert.equal(options.where.userId, 'saved-user');
    attempts += 1;
    if (attempts === 1) throw unavailable();
    return saved;
  });
  assert.deepEqual(await db.findReposByUserId('saved-user'), saved);
  assert.equal(query.mock.callCount(), 2);
});

test('a continuing connection failure is propagated instead of returning empty backups', async () => {
  const error = unavailable();
  const query = mockModel(prisma.repository, 'findMany', async () => { throw error; });
  await assert.rejects(db.findReposByUserId('saved-user'), candidate => candidate === error);
  assert.equal(query.mock.callCount(), 2);
});

test('schema and pool errors are propagated without retrying', async () => {
  for (const code of ['P2022', 'P2024']) {
    const error = new Prisma.PrismaClientKnownRequestError('Database query failed', { code, clientVersion: '5.14.0' });
    const query = mockModel(prisma.user, 'findUnique', async () => { throw error; });
    await assert.rejects(db.findUserByGithubId('github-user'), candidate => candidate === error);
    assert.equal(query.mock.callCount(), 1);
  }
});

test('the dashboard outage screen offers retry without claiming backups are pending or leaking database details', () => {
  const html = renderToStaticMarkup(React.createElement(DashboardError, {
    error: new Error('postgresql://user:password@private-database:5432/database'),
    reset() {},
  }));
  assert.match(html, /Dashboard temporarily unavailable/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /Pending Backup|Backup Now|private-database|password/);
});
