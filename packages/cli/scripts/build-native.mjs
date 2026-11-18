import './build-runtime.mjs';
import { createRequire } from 'node:module';
import { readFile, writeFile, copyFile, chmod, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { npm } from './npm.mjs';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const dist = resolve(root, '../../dist'), scratch = join(dist, '.native');
await mkdir(scratch, { recursive: true });
const main = join(scratch, 'cli.cjs'), blob = join(scratch, 'sea.blob'), config = join(scratch, 'sea.json');
await build({ stdin: { contents: "import { runCli } from './src/cli.mjs'; runCli();", resolveDir: root },
  outfile: main, bundle: true, platform: 'node', target: 'node24', format: 'cjs', legalComments: 'eof',
  define: { 'import.meta.url': 'undefined' } });
await writeFile(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
const artifact = join(dist, `rivet-v${version}-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`);
await copyFile(process.execPath, artifact); await chmod(artifact, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', artifact]);
await npm(['exec', '--yes', '--cache', join(dist, '.npm-cache'), '--package', 'postject@1.0.0-alpha.6', '--', 'postject', artifact,
  'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { cwd: root });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', artifact]);
const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
await writeFile(`${artifact}.sha256`, `${digest}  ${artifact.split(/[\\/]/).pop()}\n`);
execFileSync(artifact, ['--version'], { cwd: scratch, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '' } });
console.log(`Built ${artifact}`);
