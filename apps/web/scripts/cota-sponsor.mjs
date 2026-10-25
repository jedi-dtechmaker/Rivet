import { createECDH } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ccc } from '@ckb-ccc/core';

const secretFile = new URL('../.env.cota-sponsor.local', import.meta.url);
const command = process.argv[2];

async function main() {
  if (!['create', 'address', 'balance'].includes(command)) {
    console.log('Usage: pnpm --filter @proof/web run cota:sponsor create|address|balance');
    return;
  }

  const client = new ccc.ClientPublicTestnet({ url: 'https://testnet.ckb.dev/' });
  if (command === 'create') {
    const keyPair = createECDH('secp256k1');
    keyPair.generateKeys();
    const privateKey = `0x${keyPair.getPrivateKey().toString('hex').padStart(64, '0')}`;
    const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
    const address = await signer.getRecommendedAddress();
    try {
      await writeFile(secretFile, `COTA_SPONSOR_PRIVATE_KEY="${privateKey}"\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error('A sponsor key file already exists. Use the address command to inspect the existing account.');
      }
      throw new Error('Could not save the sponsor key file.');
    }
    console.log(`Testnet sponsor address: ${address}`);
    console.log(`Private key saved locally to ${fileURLToPath(secretFile)} (owner access only).`);
    console.log('Open that file in your editor and copy its setting into apps/web/.env. Do not share the key.');
    console.log('Fund the public address at https://faucet.nervos.org/ before enabling sponsorship.');
    return;
  }

  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  dotenv.config({ path: fileURLToPath(secretFile), quiet: true });
  if (!process.env.COTA_SPONSOR_PRIVATE_KEY) throw new Error('Create or configure a testnet sponsor first.');
  let signer;
  try { signer = new ccc.SignerCkbPrivateKey(client, process.env.COTA_SPONSOR_PRIVATE_KEY); }
  catch { throw new Error('The configured sponsor key is invalid.'); }
  console.log(`Testnet sponsor address: ${await signer.getRecommendedAddress()}`);
  if (command === 'balance') {
    try { console.log(`Spendable CKB balance: ${ccc.fixedPointToString(await signer.getBalance())}`); }
    catch { throw new Error('Could not read the testnet balance. Please retry.'); }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
