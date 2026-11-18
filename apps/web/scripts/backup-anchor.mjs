import { ccc } from '@ckb-ccc/core';
import { parseBackupAnchor } from '../../../packages/cli/src/anchor.mjs';

/** Build one successor anchor. A missing/uncertain predecessor never starts a second chain. */
export async function createBackupAnchorTransaction({ client, lock, previousOutpoint, anchorData }) {
  parseBackupAnchor(anchorData);
  const inputs = [];
  let existing;
  if (previousOutpoint) {
    const match = /^(0x[0-9a-f]{64}):(0|[1-9][0-9]*)$/i.exec(previousOutpoint);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > 0xffffffff) throw new Error('Invalid previous backup anchor outpoint.');
    const outPoint = ccc.OutPoint.from({ txHash: match[1], index: Number(match[2]) });
    // getCellLive checks liveness through RPC rather than accepting a historical output.
    existing = await client.getCellLive(outPoint, true, true);
    if (!existing) throw new Error('Previous backup anchor is not live. Reconcile its successor before another backup.');
    if (existing.cellOutput.type || !existing.cellOutput.lock.eq(lock)) throw new Error('Previous backup anchor has an unexpected owner or type.');
    parseBackupAnchor(existing.outputData);
    inputs.push(ccc.CellInput.from({ previousOutput: outPoint, cellOutput: existing.cellOutput, outputData: existing.outputData }));
  }
  const output = ccc.CellOutput.from({ lock, capacity: 0n });
  const minimum = ccc.fixedPointFrom(output.occupiedSize + ccc.bytesFrom(anchorData).length);
  output.capacity = existing && existing.cellOutput.capacity > minimum ? existing.cellOutput.capacity : minimum;
  return { transaction: ccc.Transaction.from({ inputs, outputs: [output], outputsData: [anchorData] }), reused: Boolean(existing) };
}
