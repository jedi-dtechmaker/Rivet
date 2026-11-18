import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Invoke npm's JS entry with Node, including on Windows where npm is a .cmd shim.
export async function npm(args, options = {}) {
  const candidates = [
    ...(process.env.npm_execpath?.endsWith('npm-cli.js') ? [process.env.npm_execpath] : []),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ];
  for (const candidate of candidates) {
    try { await access(candidate); } catch { continue; }
    return exec(process.execPath, [candidate, ...args], { maxBuffer: 8 * 1024 * 1024, ...options });
  }
  throw new Error('Packaging requires npm from a standard Node.js installation.');
}
