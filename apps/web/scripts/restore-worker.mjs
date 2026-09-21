/**
 * Rivet restore worker.
 *
 * Runs inside GitHub Actions because restore needs the `git` binary, a writable
 * disk and more than 60 seconds — none of which Vercel serverless provides.
 *
 * Pipeline:
 *   1. download the pinned git bundle from IPFS
 *   2. git clone the bundle into a working tree
 *   3. create the target repository on GitHub (via API)
 *   4. git push --mirror to it (all branches, tags and full history)
 *
 * Requires env: REPO_NAME, IPFS_CID, TARGET_REPO_NAME, GH_TOKEN
 * Progress is observed by the app polling the GitHub API for the new repo,
 * so there is no callback.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const { REPO_NAME, IPFS_CID, TARGET_REPO_NAME, GH_TOKEN } = process.env;

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function fail(message) {
  // Never let credentials reach the logs.
  console.error('[restore] FAILED:', String(message).replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@'));
  process.exit(1);
}

async function github(endpoint, init = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function run() {
  if (!REPO_NAME || !NAME_PATTERN.test(REPO_NAME)) {
    throw new Error(`Invalid or missing REPO_NAME: ${REPO_NAME}`);
  }
  if (!TARGET_REPO_NAME || !NAME_PATTERN.test(TARGET_REPO_NAME)) {
    throw new Error(`Invalid or missing TARGET_REPO_NAME: ${TARGET_REPO_NAME}`);
  }
  if (!IPFS_CID) throw new Error('Missing IPFS_CID');
  if (!GH_TOKEN) throw new Error('Missing GH_TOKEN');

  // Who owns the token? Needed for the push URL.
  const userRes = await github('/user');
  if (!userRes.ok) {
    throw new Error(`Could not authenticate with GitHub (${userRes.status})`);
  }
  const login = (await userRes.json()).login;
  console.log(`[restore] Target account: ${login}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rivet-restore-'));
  const bundlePath = path.join(tmpDir, 'repo.bundle');
  const workDir = path.join(tmpDir, 'work');

  try {
    // 1. Download the bundle from IPFS.
    console.log(`[restore] Downloading bundle ${IPFS_CID} ...`);
    const bundleRes = await fetch(`https://gateway.pinata.cloud/ipfs/${IPFS_CID}`);
    if (!bundleRes.ok) {
      throw new Error(`IPFS download failed (${bundleRes.status})`);
    }
    const bundleBytes = Buffer.from(await bundleRes.arrayBuffer());
    await fs.writeFile(bundlePath, bundleBytes);
    console.log(`[restore] Downloaded ${(bundleBytes.length / 1024 / 1024).toFixed(2)} MB`);

    // 2. Expand the bundle.
    console.log('[restore] Expanding bundle ...');
    await execFileAsync('git', ['clone', bundlePath, workDir]);

    // 3. Create the destination repository.
    console.log(`[restore] Creating ${login}/${TARGET_REPO_NAME} ...`);
    const createRes = await github('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: TARGET_REPO_NAME,
        description: `Restored from a Rivet backup of ${REPO_NAME} (CKB + IPFS)`,
        private: false,
        auto_init: false,
      }),
    });

    if (!createRes.ok) {
      const detail = await createRes.json().catch(() => ({}));
      const reason = detail?.errors?.[0]?.message || detail?.message || `HTTP ${createRes.status}`;
      throw new Error(`Could not create repository: ${reason}`);
    }
    const created = await createRes.json();
    console.log(`[restore] Created ${created.html_url}`);

    // 4. Mirror-push every ref (branches, tags, full history) with original dates.
    console.log('[restore] Pushing mirror ...');
    const pushUrl = `https://x-access-token:${GH_TOKEN}@github.com/${login}/${TARGET_REPO_NAME}.git`;
    await execFileAsync('git', ['-C', workDir, 'push', '--mirror', pushUrl], {
      maxBuffer: 64 * 1024 * 1024,
    });

    console.log(`[restore] Done: ${created.html_url}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((e) => fail(e?.message ?? e));
