import { ccc } from '@ckb-ccc/core';
import { argsToDid, didToArgs, resolveDidCkb } from '@ckb-ccc/did-ckb';
import { verifyCredential, type CredentialKeyType, type SigningAlg } from '@joyid/ckb';
import { createTestnetClient } from './ckb-server';

const JOYID_TESTNET_SERVER_URL = 'https://api.testnet.joyid.dev/api/v1';

export type VellumControllerSignature = {
  identity: string;
  signature: string;
  signType: 'BtcEcdsa' | 'EvmPersonal' | 'JoyId' | 'NostrEvent' | 'CkbSecp256k1' | 'DogeEcdsa';
};

export type VellumController = { client: ccc.Client; did: string; lock: ccc.Script; document: unknown };

export type VellumControllerDependencies = {
  createClient: () => ccc.Client;
  resolveDid: typeof resolveDidCkb;
  verifyMessage: typeof ccc.Signer.verifyMessage;
  verifyJoyIdCredential: typeof verifyCredential;
};

const defaultDependencies: VellumControllerDependencies = {
  createClient: createTestnetClient,
  resolveDid: resolveDidCkb,
  verifyMessage: ccc.Signer.verifyMessage,
  verifyJoyIdCredential: verifyCredential,
};

export class VellumIdentityInactiveError extends Error {}
export class VellumIdentityUnavailableError extends Error {}

export function canonicalVellumDid(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80) throw new TypeError('Enter a valid did:ckb identity.');
  try {
    const args = didToArgs(value);
    if (ccc.bytesFrom(args).length !== 20 || argsToDid(args) !== value) throw new Error();
    return value;
  } catch {
    throw new TypeError('Enter a canonical did:ckb identity.');
  }
}

export async function resolveVellumController(
  did: string,
  dependencies: VellumControllerDependencies = defaultDependencies,
): Promise<VellumController> {
  const canonical = canonicalVellumDid(did);
  const client = dependencies.createClient();
  let record;
  try { record = await dependencies.resolveDid({ client, did: canonical }); }
  catch { throw new VellumIdentityUnavailableError('The selected identity could not be resolved.'); }
  if (!record) throw new VellumIdentityInactiveError('The selected identity is not active.');
  return { client, did: record.did, lock: record.cell.cellOutput.lock, document: record.data.value.document };
}

async function signerControlsLock(
  controller: VellumController,
  proof: VellumControllerSignature,
  dependencies: VellumControllerDependencies,
): Promise<boolean> {
  const { client, lock } = controller;
  switch (proof.signType) {
    case ccc.SignerSignType.CkbSecp256k1:
      return (await new ccc.SignerCkbPublicKey(client, proof.identity).getAddressObjSecp256k1()).script.eq(lock);
    case ccc.SignerSignType.EvmPersonal:
      return (await new ccc.SignerEvmAddressReadonly(client, proof.identity).getAddressObjs()).some(({ script }) => script.eq(lock));
    case ccc.SignerSignType.BtcEcdsa: {
      const publicKey = proof.identity.startsWith('0x') ? proof.identity : `0x${proof.identity}`;
      return (await new ccc.SignerBtcPublicKeyReadonly(client, '', publicKey).getAddressObjs()).some(({ script }) => script.eq(lock));
    }
    case ccc.SignerSignType.NostrEvent:
      return (await new ccc.SignerNostrPublicKeyReadonly(client, proof.identity).getAddressObjs()).some(({ script }) => script.eq(lock));
    case ccc.SignerSignType.DogeEcdsa:
      return (await new ccc.SignerDogeAddressReadonly(client, proof.identity).getAddressObjs()).some(({ script }) => script.eq(lock));
    case ccc.SignerSignType.JoyId: {
      let identity: unknown;
      let signature: unknown;
      try { identity = JSON.parse(proof.identity); signature = JSON.parse(proof.signature); }
      catch { return false; }
      if (!identity || typeof identity !== 'object' || Array.isArray(identity) || !signature || typeof signature !== 'object' || Array.isArray(signature)) return false;
      const key = identity as { keyType?: unknown; publicKey?: unknown };
      const signed = signature as { alg?: unknown };
      if (typeof key.publicKey !== 'string' || typeof key.keyType !== 'string' || typeof signed.alg !== 'number') return false;
      const address = ccc.Address.from({ prefix: client.addressPrefix, script: lock }).toString();
      return dependencies.verifyJoyIdCredential({ pubkey: key.publicKey, address,
        keyType: key.keyType as CredentialKeyType, alg: signed.alg as SigningAlg }, JOYID_TESTNET_SERVER_URL);
    }
    default:
      return false;
  }
}

export async function verifyVellumControllerSignature(
  message: string,
  controller: VellumController,
  proof: VellumControllerSignature,
  dependencies: VellumControllerDependencies = defaultDependencies,
): Promise<boolean> {
  try {
    const signature = new ccc.Signature(proof.signature, proof.identity, proof.signType as ccc.SignerSignType);
    return (await dependencies.verifyMessage(message, signature)) && (await signerControlsLock(controller, proof, dependencies));
  } catch { return false; }
}

export function vellumDisplayName(document: unknown): string | null {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const services = (document as Record<string, unknown>).services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) return null;
  const profile = (services as Record<string, unknown>).profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const value = profile as Record<string, unknown>;
  if (value.type !== 'VellumProfile' || typeof value.displayName !== 'string') return null;
  const displayName = value.displayName.trim();
  if (!displayName || displayName.length > 160 || [...displayName].some(character => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  })) return null;
  return displayName;
}
