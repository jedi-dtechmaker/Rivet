#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseProof, verifyAnchor, verifyBundle, materializeBundle } from './proof.mjs';
import { configFile, readConfig, saveConfig, selectServer, tokenFor } from './config.mjs';
import { currentRepository, repositoryName } from './repository.mjs';
import { readToken, serverRequest } from './auth.mjs';
import { generateOwnerKey, restoreAttribution, verifyAttribution, verifyMappingAnchor } from './attribution.mjs';
import { VERSION } from './version.mjs';

const HELP = `rivet login [--server https://rivet.example] [--token-stdin]
rivet logout [--server https://rivet.example]
rivet backup [owner/repo] [--no-wait] [--proof-out recovery.json]
rivet status [owner/repo] [--proof-out recovery.json]
rivet verify [tx_hash] --proof recovery.json [--bundle encrypted.bundle]
rivet restore [owner/repo] [--mode exact|attribution] [--target ./recovered] [--proof recovery.json]
rivet keygen --out owner-key.pem
rivet verify-mapping --mapping mapping.json --owner-key owner-key.pem.pub --proof recovery.json --target rewritten.git
rivet anchor-mapping --mapping mapping.json --owner-key owner-key.pem.pub --ckb-key-file testnet-key --receipt-out anchor.json
rivet watch [directory] [--interval 30] [--once]

Install once and run rivet from your own project directories. Git is required.
npm installations also need Node 24+; standalone executables include Node.
login saves a GitHub personal token for an existing Rivet account; input is hidden.
backup and status detect the current project's GitHub origin when the name is omitted.
Backups cover public history pushed to GitHub. Local-only commits and working files are excluded.
restore creates a new bare mirror; use git clone afterwards to obtain a working tree.
Without --proof, restore retrieves the latest confirmed backup using your saved sign-in.
With --proof, verification and restore need no Rivet sign-in or original GitHub repository.
--proof-out writes private recovery keys with mode 0600. Keep it outside version control.
RIVET_TOKEN and RIVET_URL override saved settings for this session.
V2 anchors authenticate commits, refs, bundle bytes and CID; legacy anchors cover the commit set.
An anchor proves existence by block height; it does not certify Git commit timestamps.
Attribution needs --email-map mappings.json and --signing-key owner-key.pem, plus git-filter-repo.
verify-mapping accepts --anchor tx_hash and --output-index 0 to check its separate CKB anchor.
An attribution signature identifies the selected key; establish the owner's key independently.
Browser sign-in remains pending.`;

function publicStatus(result) {
  const response = { status: result.status };
  if (result.txHash) response.txHash = result.txHash;
  if (result.proof) {
    response.proof = Object.fromEntries(['protocol', 'network', 'repository', 'txHash', 'outputIndex', 'ipfsCid', 'merkleRoot',
      'refsHash', 'bundleSha256', 'commitCount', 'blockHeight'].filter(key => result.proof[key] !== undefined).map(key => [key, result.proof[key]]));
  }
  return response;
}

export async function main(argv = process.argv.slice(2), context = {}) {
  const { env = process.env, cwd = process.cwd(), request = fetch, input = process.stdin, output = process.stderr, log = console.log } = context;
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'V' }, server: { type: 'string' }, rpc: { type: 'string' }, proof: { type: 'string' },
    'proof-out': { type: 'string' }, bundle: { type: 'string' }, gateway: { type: 'string' }, 'max-bytes': { type: 'string' },
    target: { type: 'string' }, mode: { type: 'string' }, 'no-wait': { type: 'boolean' }, timeout: { type: 'string' }, 'token-stdin': { type: 'boolean' },
    'email-map': { type: 'string' }, 'signing-key': { type: 'string' }, 'owner-key': { type: 'string' }, mapping: { type: 'string' },
    out: { type: 'string' }, anchor: { type: 'string' }, 'output-index': { type: 'string' }, 'ckb-key-file': { type: 'string' },
    'receipt-out': { type: 'string' }, interval: { type: 'string' }, once: { type: 'boolean' },
  } });
  let [command, subject] = positionals;
  if (values.version) { log(`rivet ${VERSION}`); return; }
  if (values.help || !command) { log(HELP); return; }
  if (!['login', 'logout', 'backup', 'status', 'verify', 'restore', 'keygen', 'verify-mapping', 'anchor-mapping', 'watch'].includes(command) || positionals.length > 2
    || (['login', 'logout'].includes(command) && subject)) throw new Error('Invalid command. Run rivet --help.');

  // Offline verification never reads saved credentials or contacts Rivet.
  const authenticated = async () => {
    const config = await readConfig(configFile(env));
    const server = selectServer(values, env, config);
    return serverRequest(server, tokenFor(server, env, config), request);
  };
  if (command === 'keygen') {
    if (!values.out || subject) throw new Error('Use rivet keygen --out owner-key.pem.');
    log(JSON.stringify(await generateOwnerKey(resolve(cwd, values.out)), null, 2)); return;
  }
  if (command === 'watch') {
    const { watchRepository } = await import('./watch.mjs');
    await watchRepository(resolve(cwd, subject || '.'), await authenticated(), { interval: values.interval, once: values.once,
      signal: context.signal, log, output }); return;
  }
  if (command === 'anchor-mapping') {
    if (!values.mapping || !values['owner-key'] || !values['ckb-key-file'] || !values['receipt-out']) throw new Error('Use --mapping, --owner-key, --ckb-key-file and --receipt-out for attribution anchoring.');
    const { anchorMapping } = await import('./mapping-anchor.mjs');
    const result = await anchorMapping({ document: JSON.parse(await readFile(resolve(cwd, values.mapping), 'utf8')),
      ownerKey: await readFile(resolve(cwd, values['owner-key']), 'utf8'), keyFile: resolve(cwd, values['ckb-key-file']),
      receiptFile: resolve(cwd, values['receipt-out']), rpcUrl: values.rpc });
    log(JSON.stringify(result, null, 2)); return;
  }
  if (command === 'login' || command === 'logout') {
    const file = configFile(env), config = await readConfig(file), server = selectServer(values, env, config);
    if (command === 'logout') {
      delete config.accounts[server];
      await saveConfig(file, config);
      log(`Saved sign-in removed for ${server}.${env.RIVET_TOKEN ? ' RIVET_TOKEN is still set in this shell; unset it to end that override.' : ''}`);
      return;
    }
    const token = await readToken({ tokenStdin: values['token-stdin'], env, input, output });
    let account;
    try { account = await serverRequest(server, token, request)('/api/cli/account'); }
    catch (error) {
      if (error.status === 404) throw new Error('The Rivet server needs the CLI sign-in update. Select an updated deployment with --server.');
      throw error;
    }
    if (typeof account.githubId !== 'string' || !/^[1-9][0-9]*$/.test(account.githubId)
      || (account.username !== null && (typeof account.username !== 'string' || !/^[a-z0-9-]{1,39}$/i.test(account.username)))) {
      throw new Error('The Rivet server returned an invalid account response.');
    }
    config.accounts[server] = { token, githubId: account.githubId, username: account.username };
    config.activeServer = server;
    await saveConfig(file, config);
    log(`Signed in as ${account.username || account.githubId} on ${server}.`);
    return;
  }

  const showStatus = async result => {
    if (result.status === 'confirmed') parseProof(result.proof);
    const visible = publicStatus(result);
    if (values['proof-out']) {
      if (result.status !== 'confirmed' || !result.proof) throw new Error('No confirmed backup is available to export. Use rivet status again after confirmation.');
      const file = resolve(cwd, values['proof-out']);
      await writeFile(file, JSON.stringify(parseProof(result.proof), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      visible.recoveryFile = file;
    }
    log(JSON.stringify(visible, null, 2));
  };
  if (command === 'backup' || command === 'status') {
    subject = subject ? repositoryName(subject) : await currentRepository(cwd);
    const send = await authenticated();
    if (command === 'backup') {
      const timeout = Number(values.timeout || 900);
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error('Backup timeout must be 1–3600 seconds.');
      if (values['no-wait'] && values['proof-out']) throw new Error('Use --proof-out with a waiting backup, or export it later with rivet status.');
      output.write(`Backing up public GitHub history for ${subject}. Local-only commits and working files are excluded.\n`);
      const result = await send('/api/cli/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoFullName: subject }) });
      log(JSON.stringify(result, null, 2));
      if (values['no-wait']) return;
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        const status = await send(`/api/cli/status?repo=${encodeURIComponent(subject)}&since=${encodeURIComponent(result.startedAt)}${values['proof-out'] ? '&includeSecrets=true' : ''}`);
        if (status.status === 'confirmed' && status.proof && status.proof.txHash !== result.previousTxHash) { await showStatus(status); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      throw new Error('Backup is still pending. Use rivet status; do not dispatch another backup.');
    }
    await showStatus(await send(`/api/cli/status?repo=${encodeURIComponent(subject)}${values['proof-out'] ? '&includeSecrets=true' : ''}`));
    return;
  }

  if (command === 'restore' && values.mode && !['exact', 'attribution'].includes(values.mode)) throw new Error('Use --mode exact or --mode attribution.');
  if (command === 'restore' && values.mode === 'attribution' && (!values['email-map'] || !values['signing-key'])) throw new Error('Use --email-map mappings.json and --signing-key owner-key.pem for attribution restore.');
  if (command === 'verify-mapping' && (!values.mapping || !values['owner-key'] || !values.target)) throw new Error('Use --mapping, --owner-key, --proof and --target for attribution verification.');
  let proof;
  if (values.proof) proof = parseProof(JSON.parse(await readFile(resolve(cwd, values.proof), 'utf8')));
  else if (command === 'restore') {
    subject = subject ? repositoryName(subject) : await currentRepository(cwd);
    const result = await (await authenticated())(`/api/cli/status?repo=${encodeURIComponent(subject)}&includeSecrets=true`);
    if (result.status !== 'confirmed' || !result.proof) throw new Error('No confirmed backup is available. Use rivet status again after confirmation.');
    proof = parseProof(result.proof);
  } else throw new Error('Provide --proof recovery.json. Verification does not query the original repository.');
  if (command === 'verify' && subject && subject.toLowerCase() !== proof.txHash.toLowerCase()) throw new Error('Transaction differs from the recovery proof.');
  if (command === 'restore') {
    subject = repositoryName(subject || proof.repository);
    if (subject.toLowerCase() !== proof.repository?.toLowerCase()) throw new Error('Repository differs from the recovery proof.');
  }
  const target = command === 'restore' ? resolve(cwd, values.target || `${subject.split('/')[1]}-restored.git`) : undefined;
  const anchor = await verifyAnchor(proof, values.rpc || env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/', request);
  if (command === 'verify-mapping') {
    const document = JSON.parse(await readFile(resolve(cwd, values.mapping), 'utf8'));
    const ownerKey = await readFile(resolve(cwd, values['owner-key']), 'utf8');
    const temp = await mkdtemp(join(tmpdir(), 'rivet-mapping-verify-'));
    try {
      const original = join(temp, 'original.git');
      await materializeBundle(proof, { bundle: values.bundle && resolve(cwd, values.bundle), gateway: values.gateway, maxBytes: values['max-bytes'] },
        file => verifyBundle(file, proof, original));
      const result = await verifyAttribution(document, ownerKey, original, resolve(cwd, values.target), proof);
      const mappingAnchor = values.anchor ? await verifyMappingAnchor(document, values.anchor, Number(values['output-index'] || 0),
        values.rpc || env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/', request) : undefined;
      log(JSON.stringify({ ...result, sourceAnchor: anchor, ...(mappingAnchor ? { mappingAnchor } : { anchored: false }) }, null, 2));
    } finally { await rm(temp, { recursive: true, force: true }); }
    return;
  }
  if (command === 'restore' && values.mode === 'attribution') {
    const mappings = JSON.parse(await readFile(resolve(cwd, values['email-map']), 'utf8'));
    const key = await readFile(resolve(cwd, values['signing-key']), 'utf8');
    const result = await materializeBundle(proof, { bundle: values.bundle && resolve(cwd, values.bundle), gateway: values.gateway, maxBytes: values['max-bytes'] },
      file => restoreAttribution(file, proof, target, mappings, key));
    log(JSON.stringify({ valid: true, mode: 'attribution', sourceAnchor: anchor, ...result, anchored: false }, null, 2)); return;
  }
  const bundle = await materializeBundle(proof, { bundle: values.bundle && resolve(cwd, values.bundle), gateway: values.gateway, maxBytes: values['max-bytes'] },
    file => verifyBundle(file, proof, target));
  log(JSON.stringify({ valid: true, network: 'ckb-testnet', ...anchor, ...bundle,
    ...(target ? { restored: target, bare: true, nextStep: 'Use git clone <restored-path> <new-working-directory> to get working files.' } : {}) }, null, 2));
}

export function runCli() {
  return main().catch(error => {
    const safe = error instanceof Error && /^(Attribution |Saved transaction|Transaction (submission|is still)|Invalid command|Use |Do not put credentials|Run rivet|Could not (detect|reach|read)|The origin remote|The Rivet server|Rivet (request|credentials|configuration)|RIVET_CONFIG_DIR|Sign-in |Invalid GitHub token|Provide --proof|No confirmed backup|Transaction differs|Repository differs|Backup (is still pending|timeout|differs)|Invalid testnet|Bundle (commits|bytes|refs|exceeds)|IPFS bundle|Invalid AES)/.test(error.message);
    console.error(safe ? error.message : error?.code === 'EEXIST' ? 'The destination already exists. Choose a new path.' : 'Rivet command failed. Check arguments, sign-in, recovery file and network connectivity. Run rivet --help.');
    process.exitCode = 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) runCli();
