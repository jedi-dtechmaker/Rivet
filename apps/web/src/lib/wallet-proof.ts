import { ccc } from '@ckb-ccc/core';

export function createWalletMessage(origin: string, githubId: string, address: string, nonce: string, expiresAt: Date) {
  return [
    'Link this JoyID wallet to your Rivet account.',
    `Website: ${origin}`,
    'Network: CKB testnet',
    `GitHub account ID: ${githubId}`,
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt.toISOString()}`,
    'This signature verifies wallet ownership. It does not authorize spending.',
  ].join('\n');
}

export async function parseJoyIdAddress(address: unknown, client: ccc.Client) {
  if (typeof address !== 'string' || address.length > 200 || !address.startsWith('ckt1')) {
    throw new Error('Connect a CKB testnet JoyID wallet.');
  }
  const parsed = await ccc.Address.fromString(address, client);
  const known = await client.getKnownScript(ccc.KnownScript.JoyId);
  if (parsed.script.codeHash !== known.codeHash || parsed.script.hashType !== known.hashType) {
    throw new Error('Use JoyID to activate your Rivet identity.');
  }
  return parsed;
}

export async function verifyWalletProof(
  message: string,
  address: string,
  proof: unknown,
  request: typeof fetch = fetch,
) {
  if (!proof || typeof proof !== 'object') return false;
  const supplied = proof as Partial<ccc.Signature>;
  if (supplied.signType !== ccc.SignerSignType.JoyId ||
      typeof supplied.identity !== 'string' || supplied.identity.length > 2000 ||
      typeof supplied.signature !== 'string' || supplied.signature.length > 16000) return false;

  try {
    const identity = JSON.parse(supplied.identity);
    const signature = JSON.parse(supplied.signature);
    if (!['main_key', 'sub_key'].includes(identity.keyType) ||
        typeof identity.publicKey !== 'string' || !/^[0-9a-f]+$/i.test(identity.publicKey) ||
        ![-7, -257].includes(signature.alg) ||
        typeof signature.message !== 'string' || typeof signature.signature !== 'string') return false;

    const verified = await ccc.Signer.verifyMessage(message, {
      signType: ccc.SignerSignType.JoyId,
      identity: JSON.stringify({ publicKey: identity.publicKey, keyType: identity.keyType }),
      signature: JSON.stringify({ alg: signature.alg, message: signature.message, signature: signature.signature }),
    });
    if (!verified) return false;

    const response = await request(`https://api.testnet.joyid.dev/api/v1/credentials/${encodeURIComponent(address)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('JoyID ownership verification is unavailable. Please retry.');
    const result = await response.json();
    if (!Array.isArray(result.credentials)) throw new Error('JoyID returned an invalid credential response.');
    return result.credentials.some((credential: { public_key?: string; ckb_address?: string }) => {
      const publicKey = signature.alg === -257 ? credential.public_key : credential.public_key?.slice(2);
      return credential.ckb_address === address && publicKey?.toLowerCase() === identity.publicKey.toLowerCase();
    });
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}
