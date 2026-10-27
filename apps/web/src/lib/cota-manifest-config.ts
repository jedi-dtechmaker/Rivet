import { ccc } from '@ckb-ccc/core';
import { createTestnetClient } from './ckb-server';

export const manifestFeatureEnabled = () => process.env.COTA_MANIFEST_ENABLED === 'true';

export async function manifestIssuer(client: ccc.Client = createTestnetClient(), requireCollection = true) {
  const key = process.env.COTA_MANIFEST_ISSUER_PRIVATE_KEY;
  if (!key) throw new Error('CoTA manifest issuer setup is incomplete.');
  const signer = new ccc.SignerCkbPrivateKey(client, key);
  const lock = (await signer.getRecommendedAddressObj()).script;
  const collectionId = process.env.COTA_MANIFEST_COLLECTION_ID?.toLowerCase();
  if (requireCollection && !/^0x[0-9a-f]{40}$/.test(collectionId || '')) throw new Error('CoTA manifest collection setup is incomplete.');
  // Zero allows every eligible account. Operators may set a positive trial
  // budget; the issuance stream still serializes allocation of unique tokens.
  const limit = Number(process.env.COTA_MANIFEST_MAX_ENROLLMENTS || '0');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('CoTA manifest enrollment limit is invalid.');
  return { signer, lock, collectionId: collectionId || null, limit };
}

export function transactionJson(transaction: ccc.Transaction) {
  return JSON.parse(transaction.stringify());
}
