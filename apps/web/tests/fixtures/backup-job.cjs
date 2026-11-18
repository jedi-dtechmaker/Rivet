const { ccc } = require('@ckb-ccc/core');
const { encodeBackupAnchor } = require('../../../../packages/cli/src/anchor.mjs');

exports.backupFixture = function backupFixture(previous) {
  const data = { merkleRoot: `0x${'11'.repeat(32)}`, refsHash: `0x${'22'.repeat(32)}`, bundleSha256: `0x${'33'.repeat(32)}`,
    ipfsCid: `bafy${'a'.repeat(40)}`, commitCount: 2 };
  const lock = { codeHash: `0x${'44'.repeat(32)}`, hashType: 'type', args: `0x${'55'.repeat(20)}` };
  const transaction = ccc.Transaction.from({
    inputs: previous ? [{ previousOutput: { txHash: previous.split(':')[0], index: Number(previous.split(':')[1]) } }] : [],
    outputs: [{ lock, capacity: ccc.fixedPointFrom(500) }], outputsData: [encodeBackupAnchor(data)],
  });
  const txHash = transaction.hash();
  return { transaction, saved: { signedTransaction: transaction.toHex(), txHash, result: { merkleRoot: data.merkleRoot,
    ipfsCid: data.ipfsCid, ckbTxHash: txHash, ckbCellOutpoint: `${txHash}:0`, commitsProcessed: 2,
    encryptionKey: '66'.repeat(32), encryptionIv: '77'.repeat(12), reusedCell: Boolean(previous) } } };
};
