const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createCipheriv, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('the restore worker decrypts a bundle and restores exact commits, branches, and tags with or without Pinata credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rivet-restore-regression-'));
  const source = path.join(directory, 'source');
  fs.mkdirSync(source);
  const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'Restore test']);
    fs.writeFileSync(path.join(source, 'first.txt'), 'first commit');
    git(['add', '.']);
    git(['commit', '-m', 'first']);
    git(['tag', 'v1']);
    git(['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(source, 'feature.txt'), 'feature branch');
    git(['add', '.']);
    git(['commit', '-m', 'feature']);
    git(['checkout', 'main']);
    fs.writeFileSync(path.join(source, 'main.txt'), 'main branch');
    git(['add', '.']);
    git(['commit', '-m', 'main']);
    const expected = git(['for-each-ref', '--format=%(refname):%(objectname)', 'refs/heads', 'refs/tags']);
    const bundle = path.join(directory, 'source.bundle');
    git(['bundle', 'create', bundle, '--all']);
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(fs.readFileSync(bundle)), cipher.final(), cipher.getAuthTag()]);
    const encryptedFile = path.join(directory, 'encrypted.bundle');
    fs.writeFileSync(encryptedFile, encrypted);
    for (const pinata of ['', 'generated-test-pinata-token']) {
      const destination = path.join(directory, pinata ? 'with-pinata.git' : 'without-pinata.git');
      git(['init', '--bare', destination]);
      const result = spawnSync(process.execPath, ['--import', path.join(__dirname, 'fixtures/restore-worker-mock.mjs'), path.join(__dirname, '../scripts/restore-worker.mjs')], {
        env: { ...process.env, REPO_NAME: 'source', IPFS_CID: 'generated-test-cid', TARGET_REPO_NAME: 'restored', GH_TOKEN: 'generated-test-token', PINATA_JWT: pinata, ENCRYPTION_KEY: key.toString('hex'), ENCRYPTION_IV: iv.toString('hex'), RIVET_TEST_BUNDLE: encryptedFile, RIVET_TEST_DESTINATION: destination },
        encoding: 'utf8', timeout: 30000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const restored = git(['--git-dir', destination, 'for-each-ref', '--format=%(refname):%(objectname)', 'refs/heads', 'refs/tags']);
      assert.equal(restored, expected);
      assert.doesNotMatch(result.stdout + result.stderr, /generated-test-token|generated-test-pinata-token/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
