#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseProof, verifyAnchor, verifyBundle, materializeBundle } from './proof.mjs';
export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, server: { type: 'string' }, rpc: { type: 'string' }, proof: { type: 'string' },
    'proof-out': { type: 'string' }, bundle: { type: 'string' }, gateway: { type: 'string' }, 'max-bytes': { type: 'string' },
    target: { type: 'string' }, mode: { type: 'string' }, 'no-wait': { type: 'boolean' }, timeout: { type: 'string' },
  } });
  const [command, subject] = positionals;
  if (values.help || !command) {
    console.log(`rivet backup <owner/repo> [--server https://rivet.example] [--no-wait]
rivet status <owner/repo> [--proof-out recovery.json]
rivet verify <tx_hash> --proof recovery.json [--bundle encrypted.bundle]
rivet restore <owner/repo> --mode exact --proof recovery.json --target ./recovered.git

Node 24+ and Git required. Use RIVET_TOKEN for a GitHub token linked to an existing Rivet account.
--proof-out writes private recovery keys with mode 0600. Keep it secure.
Verification uses CKB testnet RPC and an IPFS gateway; --bundle supports local recovery.
Legacy anchors prove commit-set existence by block height, not truthful commit timestamps, CID, bytes or refs.
Attribution restore and standalone binaries are pending Milestone 2 work.`);
    return;
  }
  if (!['backup', 'status', 'verify', 'restore'].includes(command) || !subject || positionals.length !== 2) throw new Error('Invalid command. Run rivet --help.');
  const serverRequest = async (path, init = {}) => {
    const server = new URL(values.server || process.env.RIVET_URL || 'http://localhost:3000');
    if (server.username || server.password) throw new Error('Do not put credentials in the Rivet URL.');
    if (server.protocol !== 'https:' && !(server.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname))) throw new Error('Use HTTPS for the Rivet server.');
    if (!process.env.RIVET_TOKEN) throw new Error('Set RIVET_TOKEN to a GitHub token for your Rivet account.');
    const response = await fetch(new URL(path, server), { ...init, redirect: 'error',
      headers: { ...init.headers, Authorization: `Bearer ${process.env.RIVET_TOKEN}` }, signal: AbortSignal.timeout(60000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Rivet request failed.');
    return body;
  };
  if (command === 'backup' || command === 'status') {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(subject)) throw new Error('Use owner/repository.');
    if (command === 'backup') {
      const timeout = Number(values.timeout || 900);
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error('Backup timeout must be 1–3600 seconds.');
      const result = await serverRequest('/api/cli/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoFullName: subject }) });
      console.log(JSON.stringify(result, null, 2));
      if (values['no-wait']) return;
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        const status = await serverRequest(`/api/cli/status?repo=${encodeURIComponent(subject)}&since=${encodeURIComponent(result.startedAt)}`);
        if (status.status === 'confirmed' && status.proof.txHash !== result.previousTxHash) { console.log(JSON.stringify(status, null, 2)); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      throw new Error('Backup is still pending. Use rivet status; do not dispatch another backup.');
    }
    const result = await serverRequest(`/api/cli/status?repo=${encodeURIComponent(subject)}${values['proof-out'] ? '&includeSecrets=true' : ''}`);
    if (values['proof-out'] && result.proof) {
      await writeFile(resolve(values['proof-out']), JSON.stringify(result.proof, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      delete result.proof.encryptionKey; delete result.proof.encryptionIv;
      result.recoveryFile = resolve(values['proof-out']);
    }
    console.log(JSON.stringify(result, null, 2)); return;
  }
  if (!values.proof) throw new Error('Provide --proof recovery.json. Verification does not query the original repository.');
  const proof = parseProof(JSON.parse(await readFile(resolve(values.proof), 'utf8')));
  if (command === 'verify' && subject.toLowerCase() !== proof.txHash.toLowerCase()) throw new Error('Transaction differs from the recovery proof.');
  if (command === 'restore' && subject.toLowerCase() !== proof.repository?.toLowerCase()) throw new Error('Repository differs from the recovery proof.');
  if (command === 'restore' && (values.mode !== 'exact' || !values.target)) throw new Error('Use --mode exact --target <new-directory>. Attribution restore is pending.');
  const anchor = await verifyAnchor(proof, values.rpc || process.env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/');
  const bundle = await materializeBundle(proof, { bundle: values.bundle && resolve(values.bundle), gateway: values.gateway, maxBytes: values['max-bytes'] },
    file => verifyBundle(file, proof, command === 'restore' ? resolve(values.target) : undefined));
  console.log(JSON.stringify({ valid: true, network: 'ckb-testnet', ...anchor, ...bundle,
    ...(command === 'restore' ? { restored: resolve(values.target) } : {}) }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error && /^(Invalid command|Use owner|Set RIVET_TOKEN|Provide --proof|Use --mode|Transaction differs|Repository differs|Backup is still pending|Backup timeout|Invalid testnet|Bundle commits|Backup differs|IPFS bundle|Invalid AES|Use HTTPS|Do not put credentials)/.test(error.message) ? error.message : 'Rivet command failed. Check arguments, credentials, proof, wallet recovery key and network connectivity. Run rivet --help.'); process.exitCode = 1; });
}
