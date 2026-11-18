import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { mappingDigest, mappingAnchorData, verifyMappingSignature, verifyMappingAnchor } from './attribution.mjs';
import { submitSavedTransaction } from './submission.mjs';
import { createCkbClient } from './ckb-client.mjs';

export async function anchorMapping({ document, ownerKey, keyFile, receiptFile, rpcUrl = 'https://testnet.ckb.dev/' }) {
  verifyMappingSignature(document, ownerKey);
  const { ccc } = await import('../runtime/ckb.cjs');
  const client = createCkbClient(ccc, rpcUrl);
  if ((await client.requestor.request('get_blockchain_info', [])).chain !== 'ckb_testnet') throw new Error('Attribution anchoring requires CKB testnet.');
  let receipt;
  try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt) {
    if (receipt.protocol !== 'rivet-mapping-anchor-receipt-v1' || receipt.mappingDigest !== mappingDigest(document)) throw new Error('Attribution receipt belongs to another mapping.');
  } else {
    const privateKey = (await readFile(keyFile, 'utf8')).trim();
    if (!/^0x[a-f0-9]{64}$/i.test(privateKey)) throw new Error('Use a file containing a CKB testnet private key.');
    const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
    const { script: lock } = await signer.getRecommendedAddressObj();
    const data = mappingAnchorData(document), output = ccc.CellOutput.from({ lock, capacity: 0n });
    output.capacity = ccc.fixedPointFrom(output.occupiedSize + ccc.bytesFrom(data).length);
    const transaction = ccc.Transaction.from({ outputs: [output], outputsData: [data] });
    await transaction.completeInputsByCapacity(signer);
    await transaction.completeFeeBy(signer, 1000);
    const signed = await signer.signTransaction(transaction);
    receipt = { protocol: 'rivet-mapping-anchor-receipt-v1', network: 'ckb-testnet', mappingDigest: mappingDigest(document),
      txHash: signed.hash(), outputIndex: 0, signedTransaction: signed.toHex(), state: 'prepared' };
    await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const transaction = ccc.Transaction.fromBytes(receipt.signedTransaction);
  if (transaction.hash() !== receipt.txHash || transaction.outputsData[0] !== mappingAnchorData(document)) throw new Error('Attribution receipt transaction differs from its mapping.');
  await submitSavedTransaction({ txHash: receipt.txHash,
    lookup: () => client.getTransactionNoCache(receipt.txHash), broadcast: () => client.sendTransaction(transaction), polls: 60 });
  const anchor = await verifyMappingAnchor(document, receipt.txHash, receipt.outputIndex, rpcUrl);
  const temporary = `${receiptFile}.confirmed`;
  try {
    await writeFile(temporary, JSON.stringify({ ...receipt, state: 'confirmed', ...anchor }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, receiptFile);
  } finally { await rm(temporary, { force: true }); }
  return { ...anchor, mappingDigest: receipt.mappingDigest, receiptFile, state: 'confirmed' };
}
