import { ccc } from '@ckb-ccc/core';
import { getSporeScriptInfo } from '@ckb-ccc/spore';
import { unpackToRawSporeData } from '@ckb-ccc/spore/advanced';
import { ManifestProofPackage } from './cota-manifest-verify';

export const PASSPORT_CONTENT_TYPE = 'application/json';
export const PASSPORT_PROTOCOL = 'rivet-sovereign-passport-v1';

/** Plain Spore DOB with immutable, human-readable identity and proof references. */
export function passportContent(githubId: string, username: string, proof: ManifestProofPackage) {
  if (proof.binding.githubId !== githubId || !proof.manifestRoot) throw new Error('Passport identity differs from its verified manifest.');
  return JSON.stringify({ protocol: PASSPORT_PROTOCOL, name: `Rivet Sovereign Passport · ${username}`,
    network: 'ckb-testnet', githubId, githubUsername: username, ownerLockHash: proof.binding.ownerLockHash,
    manifestRoot: proof.manifestRoot, manifestTxHash: proof.manifestTxHash,
    description: 'Developer identity with a verified CoTA manifest snapshot. Repository anchors prove existence by block height, not the truth of commit timestamps.' });
}

export function verifyPassportOutput(tx: ccc.Transaction, owner: ccc.Script, content: string, sporeId: string, client: ccc.Client) {
  const info = getSporeScriptInfo(client);
  const output = tx.outputs[0];
  if (!output?.type || output.type.codeHash !== info.codeHash || output.type.hashType !== info.hashType
    || output.type.args !== sporeId || !output.lock.eq(owner) || !tx.inputs[0]
    || ccc.hashTypeId(tx.inputs[0], 0) !== sporeId) throw new Error('Passport type or ownership differs from the mint plan.');
  const data = unpackToRawSporeData(tx.outputsData[0]);
  if (data.contentType !== PASSPORT_CONTENT_TYPE || data.clusterId
    || new TextDecoder('utf-8', { fatal: true }).decode(ccc.bytesFrom(data.content)) !== content) throw new Error('Passport content differs from the verified manifest.');
}

/** Preserve the mint, change, deps and cobuild; only JoyID lock bytes may change. */
export function validatePassportSignature(unsigned: ccc.Transaction, signed: ccc.Transaction) {
  if (unsigned.hash() !== signed.hash() || signed.toBytes().length > 100000
    || signed.witnesses.length !== unsigned.witnesses.length) throw new Error('The approved passport differs from the saved mint plan.');
  const before = unsigned.getWitnessArgs(0), after = signed.getWitnessArgs(0);
  if (!after?.lock || after.lock === '0x' || after.lock === before?.lock
    || before?.inputType !== after.inputType || before?.outputType !== after.outputType
    || signed.witnesses.some((value, index) => index > 0 && value !== unsigned.witnesses[index])) throw new Error('The passport approval changes its saved witnesses.');
}
