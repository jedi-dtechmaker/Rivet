import { ccc } from '@ckb-ccc/core';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export const COTA_TESTNET = {
  type: {
    codeHash: '0x89cd8003a0eaf8e65e0c31525b7d1d5c1becefd2ea75bb4cff87810ae37764d8',
    hashType: 'type',
    args: '0x',
  },
  registry: {
    codeHash: '0x9302db6cc1344b81a5efee06962abcb40427ecfcbe69d471b01b2658ed948075',
    hashType: 'type',
    args: '0xf9910364e0ca81a0e074f3aa42fe78cfcc880da6',
  },
  registryLock: {
    codeHash: '0x1157470ca9de091c21c262bf0754b777f3529e10d2728db8f6b4e04cfc2fbb5f',
    hashType: 'data',
    args: '0x',
  },
  cellDeps: [
    { outPoint: { txHash: '0x636a786001f87cb615acfcf408be0f9a1f077001f0bbc75ca54eadfe7e221713', index: 0 }, depType: 'depGroup' },
    { outPoint: { txHash: '0x46a7625a76cf7401eff1dfe4f46138be69316518c9771c9f780a428843c6b5b1', index: 0 }, depType: 'code' },
  ],
} as const;

export function cotaTypeForLock(lock: ccc.Script) {
  return ccc.Script.from({ ...COTA_TESTNET.type, args: lock.hash().slice(0, 42) });
}

export function createCotaRegistrationTransaction(registry: ccc.Cell, owner: ccc.Script, root: string, entry: string) {
  const smtRoot = root.replace(/^0x/, '');
  const smtEntry = entry.replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/i.test(smtRoot) || !/^(?:[0-9a-f]{2})+$/i.test(smtEntry) || smtEntry.length > 200000) {
    throw new Error('Invalid CoTA registry proof.');
  }
  const data = `0x02${'00'.repeat(32)}`;
  const output = ccc.CellOutput.from({ lock: owner, type: cotaTypeForLock(owner) });
  output.capacity = BigInt(output.occupiedSize + ccc.bytesFrom(data).length);
  output.capacity *= ccc.fixedPointFrom(1);
  if (output.capacity < ccc.fixedPointFrom(150)) output.capacity = ccc.fixedPointFrom(150);
  const transaction = ccc.Transaction.from({
    inputs: [{ previousOutput: registry.outPoint, cellOutput: registry.cellOutput, outputData: registry.outputData }],
    outputs: [registry.cellOutput, output],
    outputsData: [`0x02${smtRoot}`, data],
    cellDeps: [...COTA_TESTNET.cellDeps],
  });
  transaction.setWitnessArgs(0, { inputType: `0x${smtEntry}` });
  return transaction;
}

export async function registryRpc<T>(method: string, lockHash: string): Promise<T> {
  const endpoint = new URL(process.env.COTA_REGISTRY_URL || 'https://cota.nervina.dev/registry-aggregator');
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid CoTA registry URL.');
  const send = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [lockHash] });
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = send(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      signal: AbortSignal.timeout(30000),
    }, incoming => {
      let content = '';
      incoming.setEncoding('utf8');
      incoming.on('data', chunk => { content += chunk; });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode || 0, body: content }));
    });
    request.on('error', reject);
    request.end(body);
  }).catch(error => {
    throw new Error('CoTA registry could not be reached. Please retry shortly.', { cause: error });
  });
  if (response.status < 200 || response.status >= 300) throw new Error('CoTA registry is unavailable.');
  let payload;
  try { payload = JSON.parse(response.body); }
  catch { throw new Error('CoTA registry returned an invalid response.'); }
  if (!payload || typeof payload !== 'object' || payload.error || !payload.result) throw new Error('CoTA registry could not prepare registration.');
  return payload.result as T;
}

export async function prepareCotaRegistration(client: ccc.Client, owner: ccc.Script, sponsor: ccc.Signer) {
  if (client.addressPrefix !== 'ckt') throw new Error('Only CKB testnet is supported.');
  const registry = await client.findSingletonCellByType(COTA_TESTNET.registry);
  if (!registry || !registry.cellOutput.lock.eq(COTA_TESTNET.registryLock)) throw new Error('CoTA registry cell not found.');
  const proof = await registryRpc<{ smt_root_hash: string; registry_smt_entry: string }>('register_cota_cells', owner.hash());
  const transaction = createCotaRegistrationTransaction(registry, owner, proof.smt_root_hash, proof.registry_smt_entry);
  await transaction.completeInputsByCapacity(sponsor);
  await transaction.completeFeeBy(sponsor, 1000);
  if ((await transaction.getFee(client)) > ccc.fixedPointFrom('0.01')) throw new Error('Registration fee exceeds the sponsorship limit.');
  const registryLive = await client.getCellLiveNoCache(registry.outPoint, true);
  if (!registryLive) throw new Error('CoTA registry changed. Please retry.');
  return sponsor.signTransaction(transaction);
}
