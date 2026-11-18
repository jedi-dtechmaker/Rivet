import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = createRequire(resolve(root, 'package.json'));
const workspace = createRequire(resolve(root, '../../apps/web/node_modules/tsx/package.json'));
let esbuild;
try { esbuild = local('esbuild'); } catch { esbuild = workspace('esbuild'); }
await mkdir(resolve(root, 'runtime'), { recursive: true });
let sdk;
try { sdk = local.resolve('@ckb-ccc/core'); } catch { sdk = createRequire(resolve(root, '../../apps/web/package.json')).resolve('@ckb-ccc/core'); }
await esbuild.build({ stdin: { contents: `export { ccc } from ${JSON.stringify(sdk)};`, resolveDir: root },
  bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: resolve(root, 'runtime/ckb.cjs'), legalComments: 'eof' });
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
await writeFile(resolve(root, 'src/version.mjs'), `export const VERSION = ${JSON.stringify(version)};\n`);
console.log('Built self-contained CKB runtime.');
