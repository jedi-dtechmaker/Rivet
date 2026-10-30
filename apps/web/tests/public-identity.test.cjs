const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../src/lib/db.ts');
const { publicIdentity } = require('../src/lib/public-identity.ts');
const { GET } = require('../src/app/api/profile/[username]/proof/route.ts');
test('private, unverified and unclaimed public profiles never export identity proofs', async () => {
  const original = prisma.user.findFirst;
  let calls = 0;
  try {
    prisma.user.findFirst = async () => { calls++; throw new Error('Invalid username queried the database'); };
    assert.equal(await publicIdentity('favicon.ico'), null); assert.equal(calls, 0);
    for (const user of [null, { isProfilePublic: false, ckbAddressVerifiedAt: new Date() },
      { isProfilePublic: true }, { isProfilePublic: true, ckbAddressVerifiedAt: new Date(), cotaManifestEnrollment: { status: 'issued' } }]) {
      prisma.user.findFirst = async ({ where }) => { assert.equal(where.isProfilePublic, true); return user; };
      const response = await GET(new Request('https://rivet.example/api/profile/developer/proof'), { params: Promise.resolve({ username: 'developer' }) });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'Public identity not available.' });
    }
  } finally { prisma.user.findFirst = original; }
});
