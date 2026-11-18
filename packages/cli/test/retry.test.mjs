import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryRead, responseError } from '../src/retry.mjs';
import { serverRequest } from '../src/auth.mjs';
import { submitSavedTransaction } from '../src/submission.mjs';

test('read retries are bounded, honor a capped Retry-After and stop on permanent errors', async () => {
  let attempts = 0; const waits = [];
  assert.equal(await retryRead(async () => {
    if (++attempts < 3) throw responseError(new Response(null, { status: 429, headers: { 'Retry-After': '600' } }), 'limited');
    return 'ok';
  }, { wait: async ms => waits.push(ms) }), 'ok');
  assert.deepEqual(waits, [5000, 5000]);
  attempts = 0;
  await assert.rejects(retryRead(async () => { attempts++; throw responseError(new Response(null, { status: 400 }), 'invalid'); }), /invalid/);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(retryRead(async () => { attempts++; throw new TypeError('offline'); }, { wait: async () => {} }), /offline/);
  assert.equal(attempts, 3);
});

test('a lost POST response never automatically dispatches a second backup', async () => {
  let attempts = 0;
  const send = serverRequest('https://rivet.fixture', 'test', async () => { attempts++; throw new TypeError('timeout'); });
  await assert.rejects(send('/api/cli/backup', { method: 'POST' }), /Could not reach/);
  assert.equal(attempts, 1);
});

test('uncertain transaction sends reconcile saved hashes and never build another transaction', async () => {
  let accepted = false, sent = 0;
  const run = () => submitSavedTransaction({ txHash: 'saved-hash',
    lookup: async () => accepted ? { status: 'committed' } : undefined,
    broadcast: async () => { sent++; accepted = true; throw new TypeError('response lost'); }, wait: async () => {} });
  assert.equal((await run()).status, 'committed');
  assert.equal((await run()).status, 'committed');
  assert.equal(sent, 1);
  await assert.rejects(submitSavedTransaction({ txHash: 'saved-hash', lookup: async () => undefined,
    broadcast: async () => { throw new TypeError('offline'); }, wait: async () => {} }), /uncertain/);
});
