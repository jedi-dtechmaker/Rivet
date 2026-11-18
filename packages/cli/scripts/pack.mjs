import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { npm } from './npm.mjs';
import './build-runtime.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(packageRoot, '../../dist');
await mkdir(destination, { recursive: true });
const result = await npm(['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(destination, '.npm-cache'), '--pack-destination', destination], { cwd: packageRoot });
const [{ filename }] = JSON.parse(result.stdout);
const artifact = join(destination, filename);
const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
await writeFile(`${artifact}.sha256`, `${digest}  ${filename}\n`);
console.log(`Built ${artifact}\nSHA-256: ${digest}\nInstall: npm install --global "${artifact}"`);
