const assert = require('node:assert/strict');
const { test, afterEach, mock } = require('node:test');
const nextAuth = require('next-auth/next');
const nextCache = require('next/cache');
const { db } = require('../src/lib/db.ts');
const { saveSettings } = require('../src/app/settings/actions.ts');

afterEach(() => mock.restoreAll());
const state = { error: '', saved: false };
function form(bio = 'Building useful things') {
  const data = new FormData();
  data.set('bio', bio);
  data.set('isProfilePublic', 'on');
  return data;
}

test('profile settings require GitHub authentication before any account mutation', async () => {
  mock.method(nextAuth, 'getServerSession', async () => null);
  const update = mock.method(db, 'updateUserSettings', async () => { throw new Error('Unauthorized mutation'); });
  const result = await saveSettings(state, form());
  assert.equal(result.saved, false);
  assert.match(result.error, /Sign in/);
  assert.equal(update.mock.callCount(), 0);
});

test('wallet-free accounts save only their own profile using the authenticated immutable GitHub ID', async () => {
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-owner', email: 'different@example.test' } }));
  mock.method(db, 'findUserByGithubId', async id => { assert.equal(id, 'github-owner'); return { githubUsername: 'developer', ckbAddress: null }; });
  const update = mock.method(db, 'updateUserSettings', async (id, settings) => {
    assert.equal(id, 'github-owner');
    assert.deepEqual(settings, { bio: 'Hello world', isProfilePublic: true });
    return {};
  });
  mock.method(nextCache, 'revalidatePath', () => {});
  const data = form('  Hello world  ');
  data.set('ckbAddress', 'another-wallet');
  data.set('githubId', 'another-account');
  data.set('autoSync', 'on');
  assert.deepEqual(await saveSettings(state, data), { error: '', saved: true });
  assert.equal(update.mock.callCount(), 1);
});

test('invalid bios cannot mutate settings and database failures return usable feedback', async () => {
  mock.method(nextAuth, 'getServerSession', async () => ({ user: { id: 'github-owner' } }));
  const update = mock.method(db, 'updateUserSettings', async () => { throw new Error('Unavailable'); });
  assert.equal((await saveSettings(state, form('x'.repeat(161)))).saved, false);
  assert.equal(update.mock.callCount(), 0);
  mock.method(db, 'findUserByGithubId', async () => ({ githubUsername: 'developer' }));
  const result = await saveSettings(state, form());
  assert.equal(result.saved, false);
  assert.match(result.error, /could not be saved/);
});
