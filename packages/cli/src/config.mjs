import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const DEFAULT_SERVER = 'https://rivet-web-ten.vercel.app';

export function serverOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Use a valid Rivet server URL.'); }
  if (url.username || url.password) throw new Error('Do not put credentials in the Rivet URL.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Use the Rivet server origin without a path, query or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS for the Rivet server.');
  }
  return url.origin;
}

export function configFile(env = process.env, platform = process.platform, userHome = homedir()) {
  let directory = env.RIVET_CONFIG_DIR;
  if (!directory) {
    directory = platform === 'win32' ? join(env.APPDATA || join(userHome, 'AppData', 'Roaming'), 'Rivet')
      : platform === 'darwin' ? join(userHome, 'Library', 'Application Support', 'Rivet')
        : join(env.XDG_CONFIG_HOME || join(userHome, '.config'), 'rivet');
  }
  if (!isAbsolute(directory)) throw new Error('RIVET_CONFIG_DIR and the user configuration directory must be absolute paths.');
  return join(directory, 'credentials.json');
}

export async function readConfig(file, platform = process.platform) {
  let info;
  try { info = await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, accounts: {} }; throw new Error('Could not read Rivet sign-in settings.'); }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Rivet credentials must be stored in a regular file.');
  if (platform !== 'win32' && (info.mode & 0o077)) throw new Error('Rivet credentials need private permissions. Set the credentials file mode to 0600.');
  try {
    const config = JSON.parse(await readFile(file, 'utf8'));
    if (config.version !== 1 || !config.accounts || typeof config.accounts !== 'object' || Array.isArray(config.accounts)) throw new Error();
    if (config.activeServer !== undefined) serverOrigin(config.activeServer);
    for (const [origin, account] of Object.entries(config.accounts)) {
      if (serverOrigin(origin) !== origin || !account || typeof account.token !== 'string' || !validToken(account.token)
        || typeof account.githubId !== 'string' || !/^[1-9][0-9]*$/.test(account.githubId)
        || (account.username !== null && typeof account.username !== 'string')) throw new Error();
    }
    return config;
  } catch { throw new Error('Could not read Rivet sign-in settings. Check the credentials file.'); }
}

export async function saveConfig(file, config, platform = process.platform) {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Rivet configuration must use a regular directory.');
  if (platform !== 'win32') await chmod(directory, 0o700);
  const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export const validToken = token => typeof token === 'string' && /^[\x21-\x7e]{1,900}$/.test(token);

export function selectServer(values, env, config) {
  return serverOrigin(values.server || env.RIVET_URL || config.activeServer || DEFAULT_SERVER);
}

export function tokenFor(server, env, config) {
  const token = env.RIVET_TOKEN || config.accounts[server]?.token;
  if (!validToken(token)) throw new Error('Run rivet login first, or set RIVET_TOKEN for this session.');
  return token;
}
