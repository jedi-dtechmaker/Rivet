import { git } from './proof.mjs';

export function repositoryName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
    || value.split('/').some(part => part === '.' || part === '..')) throw new Error('Use owner/repository.');
  return value;
}

export function repositoryFromRemote(value) {
  let name;
  const scp = /^git@github\.com:([^\s]+)$/i.exec(value);
  if (scp) name = scp[1];
  else {
    let url;
    try { url = new URL(value); } catch { throw new Error('The origin remote must be a GitHub repository. Supply owner/repository explicitly.'); }
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol) || url.search || url.hash) {
      throw new Error('The origin remote must be a GitHub repository. Supply owner/repository explicitly.');
    }
    name = url.pathname.slice(1);
  }
  return repositoryName(name.replace(/\.git$/, ''));
}

export async function currentRepository(cwd) {
  let remote;
  try { remote = (await git(['remote', 'get-url', 'origin'], cwd)).stdout.trim(); }
  catch { throw new Error('Could not detect this project. Run inside a Git repository with a GitHub origin, or supply owner/repository.'); }
  return repositoryFromRemote(remote);
}
