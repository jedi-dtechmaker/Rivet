const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { ccc } = require('@ckb-ccc/core');
const { commitRoot } = require('../../../packages/cli/src/proof.mjs');
const { encodeBackupAnchor, refsCommitment } = require('../../../packages/cli/src/anchor.mjs');
const run = promisify(execFile);

test('real backup worker skips bundling, encryption, upload and broadcast for unchanged Git history, including a resumed job', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivet-unchanged-worker-'));
  const source = join(directory, 'source'), fixtureFile = join(directory, 'fixture.json'), resultFile = join(directory, 'result.json');
  const git = async args => (await run('git', args, { cwd: directory })).stdout;
  try {
    await git(['init', '--initial-branch=main', source]);
    await writeFile(join(source, 'README.md'), 'Unchanged backup fixture\n');
    await git(['-C', source, 'add', 'README.md']);
    await git(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'Fixture']);
    await git(['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'tag', '-a', 'v1', '-m', 'Fixture tag']);
    const commits = (await git(['-C', source, 'log', '--all', '--format=%H'])).trim().split('\n').sort();
    const refs = (await git(['-C', source, 'for-each-ref', '--format=%(refname) %(objectname)'])).trim().split('\n');
    const snapshot = { merkleRoot: commitRoot(commits), refsHash: refsCommitment(refs), commitCount: commits.length, githubNumericId: '1001' };
    const data = encodeBackupAnchor({ ...snapshot, bundleSha256: `0x${'33'.repeat(32)}`, ipfsCid: `bafy${'a'.repeat(40)}` });
    const transaction = ccc.Transaction.from({ outputs: [{ lock: { codeHash: `0x${'44'.repeat(32)}`, hashType: 'type', args: `0x${'55'.repeat(20)}` },
      capacity: ccc.fixedPointFrom(500) }], outputsData: [data] });
    const job = { state: 'queued', checkpoint: null, previousOutpoint: `${transaction.hash()}:0`, canReuseSnapshot: true, githubNumericId: '1001' };
    for (const resumed of [false, true]) {
      await writeFile(fixtureFile, JSON.stringify({ transaction: transaction.toHex(), resultFile,
        job: resumed ? { ...job, state: 'unchanged', checkpoint: { txHash: transaction.hash(), snapshot } } : job }));
      const result = await run(process.execPath, ['--experimental-test-module-mocks', '--import', resolve(__dirname, 'fixtures/unchanged-worker.mjs'),
        resolve(__dirname, '../scripts/backup-worker.mjs')], { env: { ...process.env, REPO_FULL_NAME: 'owner/project', JOB_ID: 'fixture-job',
        CALLBACK_URL: 'https://rivet.example/api/backup/callback', CALLBACK_SECRET: 'disposable-worker-secret', PINATA_JWT: 'disposable', TREASURY_PRIVATE_KEY: 'disposable',
        RIVET_WORKER_TEST_FIXTURE: fixtureFile, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${source}.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://github.com/owner/project.git', GIT_ALLOW_PROTOCOL: 'file' } });
      assert.doesNotMatch(result.stdout, /Creating bundle|Encrypting bundle|Uploading encrypted bundle|Anchoring commits/);
      if (resumed) assert.doesNotMatch(result.stdout, /Cloning/);
      assert.deepEqual(JSON.parse(await readFile(resultFile, 'utf8')), { jobId: 'fixture-job', repoFullName: 'owner/project',
        success: true, unchanged: true, ckbTxHash: transaction.hash(), snapshot });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
