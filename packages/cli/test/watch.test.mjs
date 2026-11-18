import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../src/proof.mjs';
import { watchRepository } from '../src/watch.mjs';

test('watch dispatches pushed-ref changes once and retries a coalesced push after the active job', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivet-watch-'));
  try {
    await git(['init', directory]); await git(['remote', 'add', 'origin', 'git@github.com:owner/project.git'], directory);
    const signal = new AbortController(); let polls = 0, dispatches = 0;
    await watchRepository(directory, async (path, init) => {
      assert.equal(path, '/api/cli/backup'); assert.deepEqual(JSON.parse(init.body), { repoFullName: 'owner/project' });
      return { coalesced: ++dispatches === 1 };
    }, { signal: signal.signal, log: () => {}, output: { write: () => {} },
      readRefs: async origin => { assert.equal(origin, 'https://github.com/owner/project.git'); return `${polls < 3 ? 'a'.repeat(40) : 'b'.repeat(40)}\trefs/heads/main\n`; },
      wait: async () => { if (++polls === 5) signal.abort(); },
    });
    assert.equal(dispatches, 3, 'one coalesced attempt, one accepted snapshot, one later pushed snapshot');
    await assert.rejects(watchRepository(directory, async () => { throw new Error('must not dispatch'); }, { interval: '0' }), /interval/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
