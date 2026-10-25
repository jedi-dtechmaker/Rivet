const assert = require('node:assert/strict');
const http = require('node:http');
const { afterEach, test } = require('node:test');
const { registryRpc } = require('../src/lib/cota.ts');

const lockHash = `0x${'12'.repeat(32)}`;
let server;
let previousUrl;

async function serve(handler) {
  previousUrl = process.env.COTA_REGISTRY_URL;
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.COTA_REGISTRY_URL = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  if (previousUrl === undefined) delete process.env.COTA_REGISTRY_URL;
  else process.env.COTA_REGISTRY_URL = previousUrl;
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    server = undefined;
  }
});

test('the registry transport sends the documented lock-hash array and reads registration status', async () => {
  let received;
  await serve((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received = { method: request.method, contentType: request.headers['content-type'], body: JSON.parse(body) };
      response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { registered: false } }));
    });
  });
  assert.deepEqual(await registryRpc('check_registered_lock_hashes', lockHash), { registered: false });
  assert.equal(received.method, 'POST');
  assert.equal(received.contentType, 'application/json');
  assert.deepEqual(received.body, { jsonrpc: '2.0', id: 1, method: 'check_registered_lock_hashes', params: [lockHash] });
});

test('an interrupted connection produces an actionable registry error', async () => {
  await serve(request => request.socket.destroy());
  await assert.rejects(registryRpc('check_registered_lock_hashes', lockHash), error => {
    assert.match(error.message, /CoTA registry could not be reached/);
    assert.equal(error.cause.code, 'ECONNRESET');
    return true;
  });
});

test('a registry HTTP outage is reported separately from wallet verification', async () => {
  await serve((request, response) => { response.writeHead(503); response.end('Unavailable'); });
  await assert.rejects(registryRpc('check_registered_lock_hashes', lockHash), /CoTA registry is unavailable/);
});

test('malformed registry responses cannot prepare a registration', async () => {
  await serve((request, response) => response.end('not JSON'));
  await assert.rejects(registryRpc('register_cota_cells', lockHash), /CoTA registry returned an invalid response/);
});

test('JSON-RPC errors never return a proof as usable', async () => {
  await serve((request, response) => response.end(JSON.stringify({ error: { code: -32602, message: 'Invalid params' } })));
  await assert.rejects(registryRpc('register_cota_cells', lockHash), /CoTA registry could not prepare registration/);
});
