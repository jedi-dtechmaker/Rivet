import { ccc } from '@ckb-ccc/core';
import { COTA_TESTNET } from '@/lib/cota';
import { buildSmt, commitmentValue } from '@/lib/cota-smt';

export const WITNESS_PROTOCOL = 'rivet-witness-v1';
export const LEGACY_PROTOCOL = 'cota-smt-v1';
export const LEGACY_BLOCKED = 'This CoTA record format is incompatible with JoyID. Choose signed proof anchoring to prepare a new transaction. The previous signed attempt is preserved.';

export class UnsupportedCotaRecordError extends Error {
  readonly code = 'IDENTITY_FORMAT_UNSUPPORTED';

  constructor() { super(LEGACY_BLOCKED); }
}

export type RecordEntry = { key: string; record: Record<string, string | number> };

export function createWitnessProofTransaction(cell: ccc.Cell, records: RecordEntry[], previousProofTxHash: string | null) {
  if (!/^0x02[0-9a-f]{64}$/i.test(cell.outputData)) throw new Error('Your CoTA cell has an unsupported data format.');
  const leaves = records.map(entry => ({ key: entry.key, value: commitmentValue(entry.record) }));
  const tree = buildSmt(leaves);
  const proof = {
    protocol: WITNESS_PROTOCOL, version: 1, network: 'ckb-testnet',
    ownerLockHash: cell.cellOutput.lock.hash(),
    sourceOutpoint: `${cell.outPoint.txHash}:${cell.outPoint.index}`,
    previousProofTxHash, commitmentRoot: tree.root, cotaRoot: `0x${cell.outputData.slice(4)}`,
    records,
  };
  const transaction = ccc.Transaction.from({
    inputs: [{ previousOutput: cell.outPoint, cellOutput: cell.cellOutput.clone(), outputData: cell.outputData }],
    outputs: [cell.cellOutput.clone()], outputsData: [cell.outputData],
    cellDeps: [COTA_TESTNET.cellDeps[0]],
  });
  transaction.setWitnessArgs(0, { outputType: ccc.hexFrom(Buffer.from(JSON.stringify(proof))) });
  return { transaction, leaves: tree.leaves, root: tree.root };
}
