import { ccc } from '@ckb-ccc/connector-react';

/**
 * Constructs and signs a CKB Transaction that stores the backup proof (Merkle Root & CID) on-chain.
 */
export async function anchorBackupOnChain(
  signer: ccc.Signer,
  merkleRoot: string,
  ipfsCid: string,
  repoFullName: string
): Promise<string> {
  // 1. Convert our backup data into a hex string to store in the Cell's outputData
  // We store a JSON string for easy parsing by block explorers and indexers
  const payload = JSON.stringify({
    r: repoFullName,
    root: merkleRoot,
    cid: ipfsCid,
    t: Date.now()
  });
  
  const payloadHex = ccc.bytesFrom(payload, 'utf8');

  // 2. Build the transaction
  const addressObj = await signer.getRecommendedAddressObj();
  
  const tx = ccc.Transaction.from({
    outputs: [
      {
        lock: addressObj.script, // Use the connected wallet's lock script
        capacity: ccc.fixedPointFrom(0), // Will be calculated dynamically based on data size
      },
    ],
    outputsData: [payloadHex],
  });

  // 3. Calculate the exact amount of CKB needed to store this data
  // A standard SECP256K1 cell takes exactly 61 CKB (61 bytes). 
  // We add the byte length of our JSON payload to get the total bytes required.
  const requiredBytes = 61 + payloadHex.length;
  
  // Convert bytes to shannons (1 CKB = 100,000,000 shannons)
  tx.outputs[0].capacity = BigInt(requiredBytes) * 100000000n;

  // 4. Complete the transaction by gathering inputs from the user's wallet
  await tx.completeInputsByCapacity(signer);
  
  // Pay the network fee
  await tx.completeFeeBy(signer, 1000);

  // 5. Prompt the user's wallet (e.g. JoyID/MetaMask) to sign and broadcast the transaction
  const txHash = await signer.sendTransaction(tx);
  
  return txHash;
}
