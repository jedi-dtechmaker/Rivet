import { ccc } from '@ckb-ccc/core';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const privateKey = process.env.TREASURY_PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing TREASURY_PRIVATE_KEY");

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  const addresses = await signer.getAddresses();
  const address = addresses[0];
  console.log("Treasury Address:", address);

  // Dummy merkle root
  const merkleRoot = "0x" + "1".repeat(64);
  
  // Create an address object from the string, then get its script.
  // Address.fromString returns a Promise, so destructure after awaiting.
  const { script: lock } = await ccc.Address.fromString(address, client);

  const tx = ccc.Transaction.from({
    outputs: [{
      lock: lock,
      capacity: ccc.fixedPointFrom(93),
    }],
    outputsData: [merkleRoot]
  });

  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000); // 1000 shannons fee rate

  const txHash = await signer.sendTransaction(tx);
  console.log("TxHash:", txHash);
}

main().catch(console.error);
