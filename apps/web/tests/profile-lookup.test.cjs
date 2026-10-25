const assert = require('node:assert/strict');
const test = require('node:test');
const { db, prisma } = require('../src/lib/db.ts');

test('missing asset paths never query the user database', async () => {
  const original = prisma.user.findFirst;
  prisma.user.findFirst = async () => { throw new Error('Asset requests must not use database connections'); };
  try {
    for (const filename of ['hero-community.jpg', 'favicon.ico', 'sw.js', '.well-known']) {
      assert.equal(await db.findUserByUsername(filename), null);
    }
  } finally {
    prisma.user.findFirst = original;
  }
});
