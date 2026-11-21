import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { main } from '../src/cli.mjs';
import { configFile, readConfig, serverOrigin } from '../src/config.mjs';
import { repositoryFromRemote, currentRepository } from '../src/repository.mjs';
import { readToken } from '../src/auth.mjs';
import { commitRoot, git } from '../src/proof.mjs';

const TOKEN = 'ghp_disposable_test_credential';
const SERVER = 'https://rivet.example';
const proof = { protocol: 'rivet-backup-proof-v1', network: 'ckb-testnet', repository: 'Owner/project',
  txHash: `0x${'ab'.repeat(32)}`, outputIndex: 0, ipfsCid: `bafy${'a'.repeat(40)}`, merkleRoot: commitRoot(['1'.repeat(40)]), commitCount: 1,
  encryptionKey: '11'.repeat(32), encryptionIv: '22'.repeat(12) };
function context(directory) {
  const logs = [], messages = [];
  return { env: { RIVET_CONFIG_DIR: join(directory, 'settings') }, cwd: directory, logs, messages,
    input: Readable.from([TOKEN + '\n']), log: text => logs.push(text), output: { write: text => messages.push(text) },
    request: async () => Response.json({ githubId: '1001', username: 'Developer' }) };
}
async function withTemp(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'rivet-installed-'));
  try { await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function login(ctx, server = SERVER) {
  await main(['login', '--token-stdin', '--server', server], { ...ctx, input: Readable.from([TOKEN + '\n']) });
}

test('saved login is private, persists across commands, is scoped to one server, and logout preserves other servers', () => withTemp(async directory => {
  const ctx = context(directory);
  await login(ctx);
  const config = await readConfig(configFile(ctx.env));
  assert.equal(config.activeServer, SERVER); assert.equal(config.accounts[SERVER].token, TOKEN);
  if (process.platform !== 'win32') {
    assert.equal((await stat(configFile(ctx.env))).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'settings'))).mode & 0o777, 0o700);
  }
  let requests = 0;
  const request = async (url, options) => {
    requests++; assert.equal(url.origin, SERVER); assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.redirect, 'error');
    return Response.json({ status: 'pending' });
  };
  await main(['status', 'Owner/project'], { ...ctx, request });
  await assert.rejects(main(['status', 'Owner/project', '--server', 'https://unrelated.example'], { ...ctx, request }), /Run rivet login/);
  assert.equal(requests, 1);
  await login(ctx, 'https://second.example');
  await main(['logout', '--server', SERVER], ctx);
  const saved = await readConfig(configFile(ctx.env));
  assert.equal(saved.accounts[SERVER], undefined); assert.equal(saved.accounts['https://second.example'].token, TOKEN);
  assert.equal(saved.activeServer, 'https://second.example');
  assert.doesNotMatch(ctx.logs.join('\n') + ctx.messages.join('\n'), new RegExp(TOKEN));
}));

test('failed login and redirects cannot replace an existing saved credential or print the token', () => withTemp(async directory => {
  const ctx = context(directory); await login(ctx);
  const before = await readFile(configFile(ctx.env), 'utf8');
  for (const status of [401, 302, 503]) {
    await assert.rejects(main(['login', '--token-stdin', '--server', SERVER], { ...ctx, input: Readable.from(['other_token']),
      request: async () => Response.json({ error: TOKEN }, { status }) }), /Sign-in was rejected|Rivet request failed/);
  }
  assert.equal(await readFile(configFile(ctx.env), 'utf8'), before);
  await assert.rejects(main(['login', '--token-stdin', '--server', SERVER], { ...ctx, input: Readable.from(['other_token']),
    request: async () => Response.json({}, { status: 404 }) }), /server needs the CLI sign-in update/);
  assert.doesNotMatch(ctx.logs.join('\n'), new RegExp(TOKEN));
  for (const server of ['http://rivet.example', 'https://user:password@rivet.example', 'https://rivet.example/path', 'file:///tmp']) {
    await assert.rejects(main(['login', '--token-stdin', '--server', server], ctx));
  }
  assert.equal(serverOrigin('http://localhost:3000/'), 'http://localhost:3000');
}));

test('GitHub HTTPS, SCP and SSH origins work from a nested project directory without leaking remote credentials', () => withTemp(async directory => {
  const project = join(directory, 'project'), nested = join(project, 'src');
  await git(['init', '--initial-branch=main', project]); await mkdir(nested);
  const ctx = context(directory); await login(ctx);
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    if (url.pathname.endsWith('/backup')) { assert.equal(JSON.parse(init.body).repoFullName, 'Owner/project'); return Response.json({ accepted: true }); }
    assert.equal(url.searchParams.get('repo'), 'Owner/project'); return Response.json({ status: 'pending' });
  };
  await git(['remote', 'add', 'origin', 'https://secret_in_remote@github.com/Owner/project.git'], project);
  for (const remote of ['https://secret_in_remote@github.com/Owner/project.git', 'git@github.com:Owner/project.git', 'ssh://git@github.com/Owner/project.git']) {
    await git(['remote', 'set-url', 'origin', remote], project);
    assert.equal(repositoryFromRemote(remote), 'Owner/project'); assert.equal(await currentRepository(nested), 'Owner/project');
    await main(['status'], { ...ctx, cwd: nested, request });
  }
  await main(['backup', '--no-wait'], { ...ctx, cwd: nested, request });
  assert.equal(calls.length, 4);
  assert.match(ctx.messages.join(''), /Local-only commits and working files are excluded/);
  assert.doesNotMatch(ctx.logs.join('\n') + ctx.messages.join('\n'), /secret_in_remote/);
  await git(['remote', 'set-url', 'origin', 'https://gitlab.com/Owner/project.git'], project);
  await assert.rejects(main(['backup', '--no-wait'], { ...ctx, cwd: nested, request }), /origin remote must be a GitHub/);
  assert.equal(calls.length, 4);
  await main(['status', 'Owner/project'], { ...ctx, cwd: nested, request });
  assert.equal(calls.length, 5);
  for (const remote of ['https://github.com.evil.example/Owner/project.git', 'file:///tmp/project', 'https://github.com/Owner/project.git?token=secret', 'git@github.com:../project.git']) {
    assert.throws(() => repositoryFromRemote(remote));
  }
}));

test('backup can export a recovery file, status never prints keys, and existing exports are preserved', () => withTemp(async directory => {
  const ctx = context(directory); await login(ctx);
  const request = async (url, init) => {
    if (url.pathname.endsWith('/backup')) return Response.json({ accepted: true, startedAt: '2026-11-10T12:00:00Z', previousTxHash: null });
    assert.equal(url.searchParams.get('includeSecrets'), 'true');
    return Response.json({ status: 'confirmed', proof });
  };
  await main(['backup', 'Owner/project', '--proof-out', 'recovery.secret.json'], { ...ctx, request });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'recovery.secret.json'), 'utf8')), proof);
  assert.doesNotMatch(ctx.logs.join('\n'), /encryptionKey|encryptionIv/);
  const saved = await readFile(join(directory, 'recovery.secret.json'), 'utf8');
  await assert.rejects(main(['status', 'Owner/project', '--proof-out', 'recovery.secret.json'], { ...ctx, request }), /EEXIST/);
  assert.equal(await readFile(join(directory, 'recovery.secret.json'), 'utf8'), saved);
  await assert.rejects(main(['backup', 'Owner/project', '--no-wait', '--proof-out', 'other.json'], { ...ctx, request }), /waiting backup/);
  await assert.rejects(main(['restore', 'Owner/project'], { ...ctx, request: async () => Response.json({ status: 'pending' }) }), /No confirmed backup/);
}));

test('backup waits on its own job and accepts an unchanged confirmed snapshot without a new transaction', () => withTemp(async directory => {
  const ctx = context(directory); await login(ctx);
  let polls = 0;
  const request = async url => {
    if (url.pathname.endsWith('/backup')) return Response.json({ accepted: true, jobId: 'unchanged-job',
      startedAt: '2026-11-21T12:00:00Z', previousTxHash: proof.txHash });
    polls++; assert.equal(url.searchParams.get('jobId'), 'unchanged-job');
    return Response.json({ status: 'confirmed', unchanged: true, proof });
  };
  await main(['backup', 'Owner/project', '--proof-out', 'unchanged.secret.json'], { ...ctx, request });
  assert.equal(polls, 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'unchanged.secret.json'), 'utf8')), proof);
  const result = JSON.parse(ctx.logs.at(-1));
  assert.equal(result.unchanged, true); assert.equal(result.proof.txHash, proof.txHash);
  assert.doesNotMatch(ctx.logs.join('\n'), /encryptionKey|encryptionIv/);
}));

test('hidden token prompt suppresses input, cancels cleanly, and bounded piped input rejects malformed tokens', async () => {
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const messages = [];
  const pending = readToken({ input, env: {}, output: { write: text => messages.push(text) } });
  input.write(TOKEN + '\n');
  assert.equal(await pending, TOKEN); assert.doesNotMatch(messages.join(''), new RegExp(TOKEN));
  const cancelled = new PassThrough(); cancelled.isTTY = true; cancelled.setRawMode = () => {};
  const attempt = readToken({ input: cancelled, env: {}, output: { write() {} } });
  cancelled.write('\u0003'); await assert.rejects(attempt, /cancelled/);
  for (const value of ['bad token', '', 'x'.repeat(4097)]) {
    await assert.rejects(readToken({ tokenStdin: true, input: Readable.from([value]), env: {} }), /Invalid GitHub token/);
  }
});

test('credentials with public POSIX permissions fail closed', { skip: process.platform === 'win32' }, () => withTemp(async directory => {
  const ctx = context(directory); await login(ctx);
  await chmod(configFile(ctx.env), 0o644);
  await assert.rejects(readConfig(configFile(ctx.env)), /private permissions/);
}));
