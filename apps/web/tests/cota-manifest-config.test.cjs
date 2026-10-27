const assert = require('node:assert/strict');
const { test } = require('node:test');
const { manifestIssuer } = require('../src/lib/cota-manifest-config.ts');

test('manifest accounts are uncapped by default, with optional configurable trial budgets', async () => {
  const names = ['COTA_MANIFEST_ISSUER_PRIVATE_KEY', 'COTA_MANIFEST_COLLECTION_ID', 'COTA_MANIFEST_MAX_ENROLLMENTS'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.COTA_MANIFEST_ISSUER_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
    process.env.COTA_MANIFEST_COLLECTION_ID = `0x${'22'.repeat(20)}`;
    delete process.env.COTA_MANIFEST_MAX_ENROLLMENTS;
    assert.equal((await manifestIssuer()).limit, 0);
    process.env.COTA_MANIFEST_MAX_ENROLLMENTS = '0';
    assert.equal((await manifestIssuer()).limit, 0);
    process.env.COTA_MANIFEST_MAX_ENROLLMENTS = '100';
    assert.equal((await manifestIssuer()).limit, 100);
    process.env.COTA_MANIFEST_MAX_ENROLLMENTS = '-1';
    await assert.rejects(() => manifestIssuer(), /enrollment limit/);
  } finally {
    for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});
