import { ccc } from '@ckb-ccc/core';
import { createSpore } from '@ckb-ccc/spore';
import { PASSPORT_CONTENT_TYPE, verifyPassportOutput } from './passport';

export async function buildPassportMint(owner: ccc.Script, content: string, client: ccc.Client) {
  const signer = new ccc.SignerCkbScriptReadonly(client, owner);
  const { tx, id } = await createSpore({ signer, to: owner, data: { contentType: PASSPORT_CONTENT_TYPE, content: new TextEncoder().encode(content) } });
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.JoyId);
  // Budget for full JoyID auth while retaining the Spore cobuild witness.
  tx.setWitnessArgs(0, { lock: `0x${'00'.repeat(12000)}` });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);
  let inputCapacity = 0n;
  for (const input of tx.inputs) {
    const cell = await input.getCell(client);
    if (!cell.cellOutput.lock.eq(owner) || cell.cellOutput.type || cell.outputData !== '0x') throw new Error('Passport minting can only spend ordinary wallet capacity cells.');
    inputCapacity += cell.cellOutput.capacity;
    input.cellOutput = cell.cellOutput;
    input.outputData = cell.outputData;
  }
  if (inputCapacity - tx.outputs.reduce((sum, output) => sum + output.capacity, 0n) > ccc.fixedPointFrom('0.01')) throw new Error('Passport fee exceeds the limit.');
  verifyPassportOutput(tx, owner, content, id, client);
  return { tx, id };
}
