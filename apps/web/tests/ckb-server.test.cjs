const assert = require('node:assert/strict');
const http = require('node:http');
const { afterEach, test, mock } = require('node:test');
const { ccc } = require('@ckb-ccc/core');
const { CkbHttpTransport, createTestnetClient } = require('../src/lib/ckb-server.ts');

let server;
const previousUrl = process.env.CKB_TESTNET_RPC_URL;
const previousFamily = process.env.CKB_RPC_IP_FAMILY;

async function serve(handler) {
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  mock.restoreAll();
  if (previousUrl === undefined) delete process.env.CKB_TESTNET_RPC_URL;
  else process.env.CKB_TESTNET_RPC_URL = previousUrl;
  if (previousFamily === undefined) delete process.env.CKB_RPC_IP_FAMILY;
  else process.env.CKB_RPC_IP_FAMILY = previousFamily;
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    server = undefined;
  }
});

test('server RPC uses HTTP directly without fetch or implicit websocket fallbacks', async () => {
  let received;
  process.env.CKB_TESTNET_RPC_URL = await serve((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received = JSON.parse(body);
      response.end(JSON.stringify({ jsonrpc: '2.0', id: received.id, result: '0x12' }));
    });
  });
  const fetch = mock.method(globalThis, 'fetch', () => { throw new Error('Must not use fetch'); });
  const client = createTestnetClient();
  const result = await client.requestor.request('get_tip_block_number', []);
  assert.equal(result, '0x12');
  assert.equal(received.method, 'get_tip_block_number');
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(client.addressPrefix, 'ckt');
});

test('RPC validation failures preserve their code and are not retried', async () => {
  let requests = 0;
  process.env.CKB_TESTNET_RPC_URL = await serve((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests += 1;
      response.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, error: { code: -302, message: 'TransactionFailedToVerify', data: 'ValidationFailure' } }));
    });
  });
  const client = createTestnetClient();
  await assert.rejects(client.sendTransaction(ccc.Transaction.from({}), 'passthrough'), error => error.code === -302);
  assert.equal(requests, 1);
});

test('HTTP outages and malformed responses produce actionable errors without response bodies', async () => {
  let unavailable = true;
  const url = await serve((request, response) => {
    if (unavailable) response.writeHead(503);
    response.end('private response content');
  });
  const transport = new CkbHttpTransport(url);
  const payload = { jsonrpc: '2.0', id: 1, method: 'get_tip_block_number', params: [] };
  await assert.rejects(transport.request(payload), /RPC is unavailable/);
  unavailable = false;
  await assert.rejects(transport.request(payload), /RPC returned an invalid response/);
});

test('a stalled RPC request is aborted and preserves its timeout cause', async () => {
  const url = await serve(() => {});
  const transport = new CkbHttpTransport(url, 25);
  await assert.rejects(transport.request({ jsonrpc: '2.0', id: 1, method: 'get_tip_block_number', params: [] }), error => {
    assert.match(error.message, /RPC could not be reached/);
    assert.equal(error.cause.code, 'ABORT_ERR');
    assert.equal(error.cause.cause.name, 'TimeoutError');
    return true;
  });
});

test('server RPC refuses websocket endpoints', () => {
  assert.throws(() => new CkbHttpTransport('wss://testnet.ckb.dev/ws'), /HTTP or HTTPS/);
});

test('an explicit IPv4 setting works through the configured RPC transport', async () => {
  process.env.CKB_RPC_IP_FAMILY = '4';
  process.env.CKB_TESTNET_RPC_URL = await serve((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => response.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: '0x12' })));
  });
  assert.equal(await createTestnetClient().requestor.request('get_tip_block_number', []), '0x12');
});

test('an invalid IP-family setting fails before contacting the network', () => {
  process.env.CKB_RPC_IP_FAMILY = 'unexpected';
  assert.throws(createTestnetClient, /must be 4 or 6/);
});
