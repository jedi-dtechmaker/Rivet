import { currentRepository } from './repository.mjs';
import { git } from './proof.mjs';
import { delay } from './retry.mjs';

/** Observe pushed remote refs. Never claim to upload local-only objects or working files. */
export async function watchRepository(directory, send, { interval = '30', once = false, signal, log = console.log, output = process.stderr, wait = delay,
  readRefs = async origin => (await git(['ls-remote', '--refs', origin], directory)).stdout } = {}) {
  const seconds = Number(interval);
  if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 3600) throw new Error('Use a watch interval between 5 and 3600 seconds.');
  const repo = await currentRepository(directory);
  const origin = `https://github.com/${repo}.git`;
  output.write(`Watching pushed public GitHub history for ${repo}. Push local commits to GitHub to include them.\n`);
  let last;
  do {
    if (signal?.aborted) return;
    const refs = (await readRefs(origin)).trim().split('\n').sort().join('\n');
    if (!refs) throw new Error('Could not read pushed refs for the watched repository.');
    if (refs !== last) {
      // POST is never automatically retried: an uncertain dispatch is reconciled by the server's durable repository reservation.
      const result = await send('/api/cli/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoFullName: repo }) });
      log(JSON.stringify({ watching: repo, ...result }));
      // A coalesced event needs another poll after the active backup finishes.
      if (!result.coalesced) last = refs;
    }
    if (!once && !signal?.aborted) await wait(seconds * 1000);
  } while (!once && !signal?.aborted);
}
