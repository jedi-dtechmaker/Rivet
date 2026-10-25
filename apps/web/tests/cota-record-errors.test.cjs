const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cotaRecordFailure } = require('../src/lib/cota-record-errors.ts');
const { UnsupportedCotaRecordError } = require('../src/lib/identity-proof.ts');

test('incompatible saved formats require an explicit new proof instead of another retry', () => {
  const failure = cotaRecordFailure(new UnsupportedCotaRecordError());
  assert.equal(failure.status, 422);
  assert.match(failure.message, /Choose signed proof anchoring/);
});

test('JoyID validation failures expose the script code without exposing signed transactions', () => {
  const detail = 'Verification(Error { kind: Script, inner: TransactionScriptError { source: Inputs[0].Lock, cause: ValidationFailure: see error code 16 on page https://nervosnetwork.github.io/ckb-script-error-codes/by-type-hash/d23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac.html#16 } })';
  const failure = cotaRecordFailure(Object.assign(new Error('private transaction payload'), { code: -302, data: detail }));
  assert.equal(failure.status, 422);
  assert.match(failure.message, /JoyID lock verification at input 0 \(script error 16\)/);
  assert.equal(failure.diagnostics.scriptCode, 16);
  assert.equal(failure.diagnostics.source, 'Inputs');
  assert.doesNotMatch(JSON.stringify(failure), /private transaction payload/);
});

test('unknown validation failures need review instead of being reported as connection outages', () => {
  const failure = cotaRecordFailure({ code: -302, data: 'unrecognized private payload' });
  assert.equal(failure.status, 422);
  assert.match(failure.message, /needs review/);
  assert.doesNotMatch(JSON.stringify(failure), /unrecognized private payload/);
});

test('connection failures report nested network codes without leaking request bodies or credentials', () => {
  const failure = cotaRecordFailure(new TypeError('fetch failed: private URL', {
    cause: new Error('private request body', { cause: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }),
  }));
  assert.equal(failure.status, 503);
  assert.equal(failure.diagnostics.causeCode, 'ETIMEDOUT');
  assert.equal(failure.message, undefined);
  assert.doesNotMatch(JSON.stringify(failure), /private/);
});

test('database and unexpected failures retain service-unavailable status', () => {
  assert.equal(cotaRecordFailure({ code: 'P1001' }).diagnostics.code, 'P1001');
  assert.equal(cotaRecordFailure(null).status, 503);
  assert.equal(cotaRecordFailure(new Error('unexpected')).status, 503);
});

test('database startup and transaction timeouts explain that the prepared proof is preserved', () => {
  for (const code of ['P1001', 'P1002', 'P2024', 'P2028']) {
    const failure = cotaRecordFailure(Object.assign(new Error('private database connection string'), { code }));
    assert.equal(failure.status, 503);
    assert.match(failure.message, /database connection timed out/);
    assert.match(failure.message, /prepared proof is preserved/);
    assert.doesNotMatch(JSON.stringify(failure), /private database/);
  }
});

test('server RPC outages tell the caller the saved identity update is preserved', () => {
  const failure = cotaRecordFailure(new Error('CKB testnet RPC could not be reached. Please retry shortly.', {
    cause: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
  }));
  assert.equal(failure.status, 503);
  assert.equal(failure.diagnostics.causeCode, 'ETIMEDOUT');
  assert.match(failure.message, /Your saved identity update is preserved/);
});
