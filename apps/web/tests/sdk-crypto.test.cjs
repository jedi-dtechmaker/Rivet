const assert = require('node:assert/strict');
const { createHash, createPublicKey, ECDH, verify } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const coreRequire = createRequire(require.resolve('@ckb-ccc/core'));
const joyidRequire = createRequire(coreRequire.resolve('@joyid/ckb'));
const sdkPath = joyidRequire.resolve('@nervosnetwork/ckb-sdk-utils');
const { SigningKey } = coreRequire('ethers');
// Public test vector: the secp256k1 generator's private scalar is 1.
const privateKey = `0x${'0'.repeat(63)}1`;
const generator = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

for (const format of ['CommonJS', 'ES module']) {
  test(`patched CKB SDK ${format} preserves keys and interoperates with Node and ethers signatures`, async () => {
    const ECPair = format === 'CommonJS'
      ? joyidRequire('@nervosnetwork/ckb-sdk-utils').ECPair
      : (await import(pathToFileURL(path.resolve(path.dirname(sdkPath), '../lib-esm/ecpair.js')).href)).default;
    const pair = new ECPair(privateKey);
    assert.equal(pair.privateKey, privateKey);
    assert.equal(pair.getPrivateKey(), privateKey);
    assert.equal(pair.publicKey, generator);
    assert.deepEqual(pair.getPublicKey('array'), Array.from(Buffer.from(generator.slice(2), 'hex')));
    const uncompressed = ECDH.convertKey(Buffer.from(generator.slice(2), 'hex'), 'secp256k1', undefined, undefined, 'uncompressed');
    assert.equal(new ECPair(privateKey, { compressed: false }).getPublicKey('hex'), `0x${uncompressed.toString('hex')}`);
    const publicKey = createPublicKey({ format: 'jwk', key: {
      kty: 'EC', crv: 'secp256k1',
      x: uncompressed.subarray(1, 33).toString('base64url'),
      y: uncompressed.subarray(33).toString('base64url'),
    } });

    for (const message of ['Rivet backup evidence', 'Rivet wallet proof', 'Rivet recovery receipt']) {
      const digest = createHash('sha256').update(message).digest();
      const digestHex = `0x${digest.toString('hex')}`;
      const der = pair.sign(digest);
      assert.equal(pair.sign(digestHex), der);
      assert.equal(verify('sha256', Buffer.from(message), publicKey, Buffer.from(der.slice(2), 'hex')), true);
      assert.equal(pair.verify(digestHex, der), true);
      assert.equal(pair.verify(createHash('sha256').update(`${message}!`).digest(), der), false);

      const expected = new SigningKey(privateKey).sign(digestHex);
      const recoverable = pair.signRecoverable(digestHex);
      assert.equal(recoverable, `${expected.r}${expected.s.slice(2)}0${expected.yParity}`);
      assert.equal(SigningKey.recoverPublicKey(digestHex, expected), `0x${uncompressed.toString('hex')}`);
    }

    const mutableKey = Buffer.from(privateKey.slice(2), 'hex');
    const copied = new ECPair(mutableKey);
    mutableKey.fill(0);
    assert.equal(copied.publicKey, generator);
    for (const invalid of [undefined, '01', '0x01', `0x${'0'.repeat(64)}`, `0x${'f'.repeat(64)}`, new Uint8Array(31)]) {
      assert.throws(() => new ECPair(invalid));
    }
  });
}
