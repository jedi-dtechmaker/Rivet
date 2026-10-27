const assert = require('node:assert/strict');
const { test } = require('node:test');
const { waitForManifestStep, ManifestWaitError } = require('../src/lib/cota-manifest-wait.ts');

test('normal wallet results return without changing the approved transaction', async () => {
  const signed = { witnesses: ['0x1234'] };
  assert.equal(await waitForManifestStep(Promise.resolve(signed), 'wallet', 100), signed);
});

test('a stuck wallet stops blocking the page and a late signature cannot submit', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const submitted = [];
  const attempt = (async () => {
    const signed = await waitForManifestStep(pending, 'wallet', 10);
    submitted.push(signed);
  })();
  await assert.rejects(attempt, error => error instanceof ManifestWaitError && error.stage === 'wallet' && /did not submit/.test(error.message));
  finish({ witnesses: ['0x1234'] });
  await Promise.resolve();
  assert.equal(submitted.length, 0);
});

test('stop waiting rejects promptly and clears the wallet wait', async () => {
  const controller = new AbortController();
  const waiting = waitForManifestStep(new Promise(() => {}), 'wallet', 1000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /Stopped waiting for JoyID/);
});

test('server timeout calls for reconciliation instead of assuming no broadcast occurred', async () => {
  await assert.rejects(waitForManifestStep(new Promise(() => {}), 'server', 10), /may already have been submitted/);
});
