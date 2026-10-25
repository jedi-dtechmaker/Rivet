const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { ccc } = require('@ckb-ccc/core');

function signedProof(challenge) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const exported = publicKey.export({ format: 'jwk' });
  const publicKeyHex = Buffer.concat([Buffer.from(exported.x, 'base64url'), Buffer.from(exported.y, 'base64url')]).toString('hex');
  const clientData = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: Buffer.from(challenge).toString('base64url'),
    origin: 'https://testnet.joyid.dev',
  }));
  const authenticator = Buffer.alloc(37);
  const payload = Buffer.concat([authenticator, createHash('sha256').update(clientData).digest()]);
  return {
    signType: ccc.SignerSignType.JoyId,
    identity: JSON.stringify({ publicKey: publicKeyHex, keyType: 'main_key' }),
    signature: JSON.stringify({
      alg: -7,
      message: Buffer.concat([authenticator, clientData]).toString('base64url'),
      signature: sign('sha256', payload, privateKey).toString('base64url'),
    }),
  };
}

function credentialResponse(proof, address) {
  return new Response(JSON.stringify({ credentials: [{
    public_key: `04${JSON.parse(proof.identity).publicKey}`,
    ckb_address: address,
  }] }), { status: 200 });
}

module.exports = { signedProof, credentialResponse };
