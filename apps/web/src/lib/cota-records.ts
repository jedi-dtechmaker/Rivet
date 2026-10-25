import { ccc } from '@ckb-ccc/core';
import { Prisma, CotaUpdate } from '@prisma/client';
import { prisma, readWithConnectionRetry } from '@/lib/db';
import { COTA_TESTNET, cotaTypeForLock } from '@/lib/cota';
import { buildSmt, commitmentKey, EMPTY_ROOT } from '@/lib/cota-smt';
import { createTestnetClient } from '@/lib/ckb-server';
import { createWitnessProofTransaction, LEGACY_BLOCKED, LEGACY_PROTOCOL, RecordEntry, UnsupportedCotaRecordError, WITNESS_PROTOCOL } from '@/lib/identity-proof';

const MAX_FEE = ccc.fixedPointFrom('0.01');

export function publicUpdate(update: CotaUpdate) {
  const protocol = update.protocol || LEGACY_PROTOCOL;
  const blocked = protocol === LEGACY_PROTOCOL && update.status === 'prepared';
  const transaction = ccc.Transaction.from(update.unsignedTransaction as unknown as ccc.TransactionLike);
  return {
    id: update.id, status: blocked ? 'blocked' : update.status, protocol,
    blockedReason: blocked ? LEGACY_BLOCKED : null,
    root: update.root, previousRoot: update.previousRoot,
    cotaRoot: `0x${transaction.outputsData[0].slice(4)}`,
    txHash: update.txHash, outputIndex: 0, network: 'ckb-testnet', sourceOutpoint: update.sourceOutpoint,
    records: update.records, leaves: update.leaves,
    explorerUrl: `https://pudge.explorer.nervos.org/transaction/${update.txHash}`,
    transaction: !blocked && update.status === 'prepared' && !update.signedTransaction ? update.unsignedTransaction : null,
    proofTransaction: update.status === 'confirmed' ? update.signedTransaction : null,
    witness: protocol === WITNESS_PROTOCOL ? transaction.getWitnessArgs(0)?.outputType : null,
    feeCKB: ccc.fixedPointToString(transaction.inputs[0].cellOutput!.capacity - transaction.outputs[0].capacity),
  };
}

export async function refreshCotaUpdate(update: CotaUpdate, client = createTestnetClient()) {
  if (update.status === 'confirmed' || update.status === 'rejected') return update;
  if (update.status === 'prepared' && !update.signedTransaction) return update;
  if ((update.protocol || LEGACY_PROTOCOL) === LEGACY_PROTOCOL && update.status === 'prepared') return update;
  const transaction = await client.getTransaction(update.txHash);
  if (transaction?.status === 'committed' && update.protocol === WITNESS_PROTOCOL) {
    validateSignedUpdate(ccc.Transaction.from(update.unsignedTransaction as unknown as ccc.TransactionLike), transaction.transaction);
  }
  const status = transaction?.status === 'committed' ? 'confirmed'
    : transaction?.status === 'rejected' ? 'rejected'
      : transaction?.status === 'pending' || transaction?.status === 'proposed' ? 'submitted' : update.status;
  if (status === update.status) return update;
  return prisma.cotaUpdate.update({ where: { id: update.id }, data: { status } });
}

export function createRecordsTransaction(cell: ccc.Cell, root: string, witness: string) {
  const transaction = ccc.Transaction.from({
    inputs: [{ previousOutput: cell.outPoint, cellOutput: cell.cellOutput.clone(), outputData: cell.outputData }],
    outputs: [cell.cellOutput.clone()], outputsData: [`0x02${root.slice(2)}`],
    cellDeps: [COTA_TESTNET.cellDeps[0]],
  });
  transaction.setWitnessArgs(0, { inputType: witness });
  return transaction;
}

export async function prepareRecords(githubId: string, client = createTestnetClient(), protocol = LEGACY_PROTOCOL) {
  if (protocol !== WITNESS_PROTOCOL) throw new UnsupportedCotaRecordError();
  const pending = await readWithConnectionRetry(() => prisma.cotaUpdate.findFirst({
    where: {
      user: { githubId, ckbAddressVerifiedAt: { not: null }, cotaRegistration: { is: { status: 'confirmed' } } },
      protocol, status: { in: ['prepared', 'submitted'] },
    },
    orderBy: { createdAt: 'desc' },
  }));
  if (pending) return { update: pending, unchanged: false };
  return prisma.$transaction(async database => {
    await database.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7824101)`;
    const user = await database.user.findUnique({ where: { githubId } });
    if (!user?.ckbAddress || !user.ckbAddressVerifiedAt) throw new Error('Verify your JoyID wallet first.');
    const registration = await database.cotaRegistration.findUnique({ where: { userId: user.id } });
    if (!registration || registration.status !== 'confirmed') throw new Error('Activate your CoTA identity first.');
    const pending = await database.cotaUpdate.findFirst({ where: { userId: user.id, protocol, status: { in: ['prepared', 'submitted'] } }, orderBy: { createdAt: 'desc' } });
    if (pending) return { update: pending, unchanged: false };
    const owner = await ccc.Address.fromString(user.ckbAddress, client);
    const cell = await client.findSingletonCellByType(cotaTypeForLock(owner.script));
    if (!cell || !cell.cellOutput.lock.eq(owner.script)) throw new Error('The user-owned CoTA cell could not be found.');
    const currentTransaction = await client.getTransaction(cell.outPoint.txHash);
    if (currentTransaction?.status !== 'committed') throw new Error('Your CoTA cell is awaiting confirmation.');
    const previous = await database.cotaUpdate.findFirst({ where: { userId: user.id, protocol, status: 'confirmed' }, orderBy: { createdAt: 'desc' } });
    const oldRecords = previous ? previous.records as unknown as RecordEntry[] : [];
    const records = new Map(oldRecords.map(entry => [entry.key, entry]));
    const identityKey = commitmentKey('developer');
    records.set(identityKey, { key: identityKey, record: {
      kind: 'developer', version: 1, network: 'ckb-testnet', githubId: user.githubId,
      githubUsername: user.githubUsername || '', walletLockHash: owner.script.hash(),
    } });
    const repositories = await database.repository.findMany({ where: { userId: user.id, isBackedUp: true, isPrivate: false }, orderBy: { fullName: 'asc' } });
    for (const repo of repositories) {
      if (!repo.ckbTxHash || !repo.lastBackupCid || !repo.ckbCellOutpoint) continue;
      const separator = repo.ckbCellOutpoint.lastIndexOf(':');
      const txHash = repo.ckbCellOutpoint.slice(0, separator);
      const index = Number(repo.ckbCellOutpoint.slice(separator + 1));
      if (txHash !== repo.ckbTxHash || !Number.isSafeInteger(index) || index < 0) throw new Error('A saved backup outpoint is invalid.');
      const anchor = await client.getTransaction(txHash);
      if (anchor?.status !== 'committed') throw new Error('A backup anchor is not confirmed yet. Retry after confirmation.');
      const merkleRoot = anchor.transaction.outputsData[index];
      if (!/^0x[0-9a-f]{64}$/i.test(merkleRoot || '')) throw new Error('A backup anchor has an unsupported proof format.');
      const key = commitmentKey(`backup:${repo.fullName.toLowerCase()}`);
      records.set(key, { key, record: {
        kind: 'backup', version: 1, network: 'ckb-testnet', repository: repo.fullName,
        ipfsCid: repo.lastBackupCid, merkleRoot, anchorOutpoint: repo.ckbCellOutpoint, commitCount: repo.commitCount,
      } });
    }
    const entries = [...records.values()].sort((left, right) => left.key.localeCompare(right.key));
    const update = createWitnessProofTransaction(cell, entries, previous?.txHash || null);
    if (previous && buildSmt(previous.leaves as unknown as { key: string; value: string }[]).root !== previous.root) {
      throw new Error('An earlier update has inconsistent proof data. No replacement transaction was created.');
    }
    if (previous && update.root === previous.root) return { update: previous, unchanged: true };
    const transaction = update.transaction;
    await transaction.addCellDepsOfKnownScripts(client, ccc.KnownScript.JoyId);
    const fee = BigInt(transaction.toBytes().length + 12000);
    if (fee > MAX_FEE) throw new Error('The identity update exceeds the transaction fee limit.');
    transaction.outputs[0].capacity -= fee;
    const occupied = ccc.fixedPointFrom(transaction.outputs[0].occupiedSize + ccc.bytesFrom(transaction.outputsData[0]).length);
    if (transaction.outputs[0].capacity < occupied) throw new Error('The CoTA cell needs more capacity before another update.');
    const sourceOutpoint = `${cell.outPoint.txHash}:${cell.outPoint.index}`;
    const failed = await database.cotaUpdate.findUnique({ where: { userId_sourceOutpoint_protocol: { userId: user.id, sourceOutpoint, protocol } } });
    if (failed) throw new Error('An earlier update for this cell needs review. No replacement transaction was created.');
    const saved = await database.cotaUpdate.create({ data: {
      userId: user.id, sourceOutpoint, protocol, txHash: transaction.hash(), root: update.root, previousRoot: previous?.root || EMPTY_ROOT,
      records: entries as unknown as Prisma.InputJsonValue, leaves: update.leaves,
      unsignedTransaction: JSON.parse(transaction.stringify()), status: 'prepared',
    } });
    return { update: saved, unchanged: false };
  }, { maxWait: 15000, timeout: 45000 });
}

export function validateSignedUpdate(unsigned: ccc.Transaction, signed: ccc.Transaction) {
  if (signed.hash() !== unsigned.hash() || signed.witnesses.length !== 1) throw new Error('The signed transaction differs from the prepared identity update.');
  const expected = unsigned.getWitnessArgs(0);
  const actual = signed.getWitnessArgs(0);
  if (!actual?.lock || actual.lock === '0x' || actual.inputType !== expected?.inputType || actual.outputType !== expected?.outputType) {
    throw new Error('The signed transaction differs from the prepared identity update.');
  }
}

export async function submitRecords(githubId: string, id: string, signedLike?: ccc.TransactionLike, client = createTestnetClient()) {
  const user = await readWithConnectionRetry(() => prisma.user.findUnique({ where: { githubId } }));
  if (!user) throw new Error('Account not found.');
  const saved = await readWithConnectionRetry(() => prisma.cotaUpdate.findFirst({ where: { id, userId: user.id } }));
  if (!saved) throw new Error('Identity update not found.');
  if ((saved.protocol || LEGACY_PROTOCOL) === LEGACY_PROTOCOL && saved.status !== 'confirmed') throw new UnsupportedCotaRecordError();
  let update = await refreshCotaUpdate(saved, client);
  if (update.status === 'confirmed' || update.status === 'submitted') return update;
  if (update.status === 'rejected') throw new Error('The identity update was rejected. Contact Rivet before retrying.');
  if (signedLike && !update.signedTransaction) {
    const signed = ccc.Transaction.from(signedLike);
    validateSignedUpdate(ccc.Transaction.from(update.unsignedTransaction as unknown as ccc.TransactionLike), signed);
    if (signed.toBytes().length > 1_000_000) throw new Error('The signed transaction differs from the prepared identity update.');
    await prisma.cotaUpdate.updateMany({ where: { id, userId: user.id, signedTransaction: { equals: Prisma.DbNull } }, data: { signedTransaction: JSON.parse(signed.stringify()) } });
    update = (await prisma.cotaUpdate.findUnique({ where: { id } }))!;
  }
  if (!update.signedTransaction) throw new Error('Approve this identity update in JoyID first.');
  const signed = ccc.Transaction.from(update.signedTransaction as unknown as ccc.TransactionLike);
  const unsigned = ccc.Transaction.from(update.unsignedTransaction as unknown as ccc.TransactionLike);
  const fee = unsigned.inputs[0].cellOutput!.capacity - signed.outputs[0].capacity;
  if (fee < BigInt(signed.toBytes().length)) throw new Error('The identity update exceeds the transaction fee limit.');
  await client.sendTransactionDry(signed);
  await client.sendTransaction(signed, 'passthrough');
  return prisma.cotaUpdate.update({ where: { id }, data: { status: 'submitted' } });
}
