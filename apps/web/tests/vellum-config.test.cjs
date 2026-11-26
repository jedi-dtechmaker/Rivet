const assert = require('node:assert/strict');
const test = require('node:test');
const { RIVET_BACKUP_SCHEMA_HASH, RIVET_BACKUP_SCHEMA_ID, vellumIssuerConfiguration, vellumPublicUrls } = require('../src/lib/vellum-config.ts');

test('Vellum claim issuance is disabled unless explicitly and completely configured', () => {
  assert.deepEqual(vellumIssuerConfiguration({}), { enabled: false });
  assert.deepEqual(vellumIssuerConfiguration({ RIVET_VELLUM_ISSUER_ENABLED: 'false' }), { enabled: false });
  assert.throws(() => vellumIssuerConfiguration({ RIVET_VELLUM_ISSUER_ENABLED: 'true' }), /issuer DID/);
  assert.throws(() => vellumIssuerConfiguration({ RIVET_VELLUM_ISSUER_ENABLED: 'sometimes' }), /true or false/);
});

test('enabled issuer configuration validates the DID, private credential, and confirmation depth', () => {
  const base = { RIVET_VELLUM_ISSUER_ENABLED: 'true', RIVET_VELLUM_ISSUER_DID: 'did:ckb:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    RIVET_VELLUM_ISSUER_CKB_PRIVATE_KEY: `0x${'AB'.repeat(32)}`, RIVET_VELLUM_MIN_CONFIRMATIONS: '6' };
  assert.deepEqual(vellumIssuerConfiguration(base), { enabled: true, issuerDid: base.RIVET_VELLUM_ISSUER_DID,
    issuerPrivateKey: base.RIVET_VELLUM_ISSUER_CKB_PRIVATE_KEY.toLowerCase(), minimumConfirmations: 6 });
  assert.throws(() => vellumIssuerConfiguration({ ...base, RIVET_VELLUM_MIN_CONFIRMATIONS: '0' }), /1 through 100/);
  assert.throws(() => vellumIssuerConfiguration({ ...base, RIVET_VELLUM_MIN_CONFIRMATIONS: '101' }), /1 through 100/);
  assert.throws(() => vellumIssuerConfiguration({ ...base, RIVET_VELLUM_ISSUER_CKB_PRIVATE_KEY: 'secret' }), /credential/);
  assert.throws(() => vellumIssuerConfiguration({ ...base, RIVET_VELLUM_ISSUER_DID: base.RIVET_VELLUM_ISSUER_DID.toUpperCase() }), /issuer DID/);
});

test('Rivet pins the registered backup schema and accepts only public HTTPS Vellum origins', () => {
  assert.equal(RIVET_BACKUP_SCHEMA_ID, 'rivet.repository-backup.v1');
  assert.equal(RIVET_BACKUP_SCHEMA_HASH, '0x53165e4ecfb86396f39b777bd7dca5b15994ae5ae2c330f0a4e49b733ab1b780');
  assert.deepEqual(vellumPublicUrls({}), { api: 'https://dashboard.usevellum.xyz', profile: 'https://usevellum.xyz' });
  assert.throws(() => vellumPublicUrls({ VELLUM_API_URL: 'http://localhost:3000' }), /HTTPS/);
  assert.throws(() => vellumPublicUrls({ VELLUM_PROFILE_URL: 'https://user:pass@example.com' }), /HTTPS/);
  assert.throws(() => vellumPublicUrls({ VELLUM_API_URL: 'https://example.com/api' }), /HTTPS origins/);
});
