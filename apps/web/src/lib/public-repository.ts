export const PRIVATE_BACKUP_MESSAGE = 'Private repository backups are disabled on testnet. Choose a public repository. Encrypted private backups are planned for a later release.';

export async function readPublicRepository(repoFullName: string, token?: string) {
  const response = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return { ok: false as const, status: 404, error: 'Repository not found or unavailable to this GitHub account.' };
  if (!response.ok) return { ok: false as const, status: 502, error: 'Could not verify repository access with GitHub. Please retry.' };
  const repository = await response.json();
  if (repository.private === true) return { ok: false as const, status: 403, error: PRIVATE_BACKUP_MESSAGE };
  if (repository.private !== false || typeof repository.full_name !== 'string' || repository.full_name.toLowerCase() !== repoFullName.toLowerCase()) {
    return { ok: false as const, status: 502, error: 'GitHub returned an invalid repository response.' };
  }
  return { ok: true as const, repository: repository as { full_name: string; owner?: { id?: number }; permissions?: { push?: boolean; admin?: boolean } } };
}
