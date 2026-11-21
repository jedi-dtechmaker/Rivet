import { mock } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { ccc } from '@ckb-ccc/core';

const fixture = JSON.parse(await readFile(process.env.RIVET_WORKER_TEST_FIXTURE, 'utf8'));
const transaction = ccc.Transaction.fromBytes(fixture.transaction);
mock.module('../../../../packages/cli/src/ckb-client.mjs', { namedExports: {
  createCkbClient: () => ({
    requestor: { request: async method => {
      if (method !== 'get_blockchain_info') throw new Error('Unexpected RPC method');
      return { chain: 'ckb_testnet' };
    } },
    getTransactionNoCache: async hash => {
      if (hash !== transaction.hash()) throw new Error('Unexpected transaction');
      return { status: 'committed', transaction };
    },
    getCellLive: async () => ccc.Cell.from({ outPoint: { txHash: transaction.hash(), index: 0 },
      cellOutput: transaction.outputs[0], outputData: transaction.outputsData[0] }),
    sendTransaction: async () => { throw new Error('Unchanged history must not broadcast'); },
  }),
} });
mock.module('pinata-web3', { namedExports: {
  PinataSDK: class { constructor() { throw new Error('Unchanged history must not upload'); } },
} });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.href === 'https://api.github.com/repos/owner/project') return Response.json({ id: 1001, private: false, full_name: 'owner/project' });
  if (url.origin !== 'https://rivet.example' || options.headers['x-backup-secret'] !== 'disposable-worker-secret') throw new Error('Unexpected external request');
  if (url.pathname === '/api/backup/job' && options.method === 'GET') return Response.json(fixture.job);
  if (url.pathname === '/api/backup/job' && options.method === 'PATCH') return Response.json({ acknowledged: true });
  if (url.pathname === '/api/backup/callback' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    if (body.success !== true || body.unchanged !== true || body.ckbTxHash !== transaction.hash()) throw new Error('Expected unchanged completion');
    await writeFile(fixture.resultFile, JSON.stringify(body));
    return Response.json({ acknowledged: true });
  }
  throw new Error('Unexpected worker operation');
};
