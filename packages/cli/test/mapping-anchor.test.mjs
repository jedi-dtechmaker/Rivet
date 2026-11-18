import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ccc } from '../runtime/ckb.cjs';
import { canonical, mappingAnchorData, mappingDigest } from '../src/attribution.mjs';
import { sha256 } from '../src/anchor.mjs';
import { anchorMapping } from '../src/mapping-anchor.mjs';

test('mapping anchoring resumes saved signed bytes without a private key or another spend and rejects mainnet', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'rivet-mapping-anchor-'));
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const key = publicKey.export({ type: 'spki', format: 'der' });
    const payload = { protocol: 'rivet-attribution-proof-v1', network: 'ckb-testnet', ownerPublicKey: key.toString('base64'), ownerKeyId: sha256(key) };
    const document = { payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
    const ownerKey = publicKey.export({ type: 'spki', format: 'pem' });
    const lock = { codeHash: `0x${'11'.repeat(32)}`, hashType: 'type', args: `0x${'22'.repeat(20)}` };
    const transaction = ccc.Transaction.from({ outputs: [{ lock, capacity: ccc.fixedPointFrom(100) }], outputsData: [mappingAnchorData(document)] });
    const receiptFile = join(temp, 'receipt.json'), txHash = transaction.hash(), blockHash = `0x${'33'.repeat(32)}`;
    await writeFile(receiptFile, JSON.stringify({ protocol: 'rivet-mapping-anchor-receipt-v1', network: 'ckb-testnet', mappingDigest: mappingDigest(document),
      txHash, outputIndex: 0, signedTransaction: transaction.toHex(), state: 'prepared' }), { mode: 0o600 });
    let chain = 'ckb_testnet';
    mock.method(globalThis, 'fetch', async (_url, init) => {
      const { id, method } = JSON.parse(init.body);
      assert.ok(['get_blockchain_info', 'get_transaction', 'get_header'].includes(method), 'A prepared committed transaction must never be sent again');
      const result = method === 'get_blockchain_info' ? { chain } : method === 'get_header' ? { hash: blockHash, number: '0x2a' } : {
        tx_status: { status: 'committed', block_hash: blockHash }, transaction: { hash: txHash, version: '0x0', cell_deps: [], header_deps: [], inputs: [], witnesses: [],
          outputs_data: transaction.outputsData, outputs: [{ capacity: '0x2540be400', lock: { code_hash: lock.codeHash, hash_type: lock.hashType, args: lock.args } }] },
      };
      return Response.json({ jsonrpc: '2.0', id, result });
    });
    for (let i = 0; i < 2; i++) assert.equal((await anchorMapping({ document, ownerKey, keyFile: '/missing-never-read', receiptFile, rpcUrl: 'https://rpc.fixture' })).txHash, txHash);
    assert.equal(JSON.parse(await readFile(receiptFile, 'utf8')).state, 'confirmed');
    chain = 'ckb';
    await assert.rejects(anchorMapping({ document, ownerKey, keyFile: '/missing-never-read', receiptFile, rpcUrl: 'https://rpc.fixture' }), /requires CKB testnet/);
  } finally { mock.restoreAll(); await rm(temp, { recursive: true, force: true }); }
});
