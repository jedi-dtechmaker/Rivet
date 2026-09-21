import { randomUUID } from 'crypto';

/**
 * Dispatches a backup job to the GitHub Actions worker.
 *
 * Vercel serverless functions have no `git` binary, a read-only filesystem and a
 * 10-60s timeout, so all git work runs in the "Repo Backup Worker" workflow.
 * The worker posts its result to /api/backup/callback.
 *
 * Configuration is deliberately optional-first: on Vercel the repository
 * coordinates and deployment URL are provided by the platform, so the only
 * genuinely required value is a token able to dispatch the workflow.
 */

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type DispatchResult =
  | { ok: true; jobId: string; runUrl: string; startedAt: string }
  | { ok: false; status: number; error: string };

export function isValidRepoFullName(value: unknown): value is string {
  return typeof value === 'string' && REPO_PATTERN.test(value);
}

/** Resolve the repo that hosts the workflow, preferring explicit env vars. */
function resolveWorkflowRepo(): { owner: string; name: string; ref: string } | null {
  const owner = process.env.PROOF_REPO_OWNER || process.env.VERCEL_GIT_REPO_OWNER;
  const name = process.env.PROOF_REPO_NAME || process.env.VERCEL_GIT_REPO_SLUG;
  const ref = process.env.PROOF_REPO_REF || process.env.VERCEL_GIT_COMMIT_REF || 'main';

  if (!owner || !name) return null;
  return { owner, name, ref };
}

/** Prefer the canonical public URL, fall back to the Vercel deployment URL. */
function resolveAppUrl(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

export async function dispatchBackup(
  repoFullName: string,
  sessionToken?: string,
): Promise<DispatchResult> {
  const target = resolveWorkflowRepo();
  const workflow = process.env.PROOF_BACKUP_WORKFLOW || 'backup.yml';
  const appUrl = resolveAppUrl();

  if (!target || !appUrl) {
    console.error(
      '[backup] Cannot resolve workflow repository or app URL. ' +
        'Set PROOF_REPO_OWNER + PROOF_REPO_NAME if not running on Vercel, ' +
        'and NEXT_PUBLIC_APP_URL if VERCEL_URL is unavailable.',
    );
    return { ok: false, status: 500, error: 'Backup worker is not configured on the server' };
  }

  // A dedicated dispatch token is preferred (required for the webhook path,
  // which has no user session). For an interactive backup by the repo owner we
  // can reuse their OAuth token, which already carries `repo` scope.
  const dispatchToken = process.env.GH_DISPATCH_TOKEN || sessionToken;
  if (!dispatchToken) {
    console.error('[backup] No dispatch token available (GH_DISPATCH_TOKEN or session token)');
    return { ok: false, status: 500, error: 'Backup worker is not configured on the server' };
  }

  const jobId = randomUUID();
  const callbackUrl = `${appUrl.replace(/\/$/, '')}/api/backup/callback`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.name}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dispatchToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: target.ref,
          inputs: { repoFullName, jobId, callbackUrl },
        }),
      },
    );

    // Success is 204 No Content.
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[backup] Workflow dispatch failed (${res.status}): ${detail}`);

      const hint =
        res.status === 404
          ? 'Workflow not found on the default branch, or the token lacks access.'
          : res.status === 403 || res.status === 401
            ? 'The dispatch token is invalid or lacks the required scope.'
            : 'GitHub rejected the workflow dispatch.';

      return { ok: false, status: 502, error: `Failed to start backup worker. ${hint}` };
    }

    return {
      ok: true,
      jobId,
      runUrl: `https://github.com/${target.owner}/${target.name}/actions/workflows/${workflow}`,
      startedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    console.error('[backup] Error dispatching workflow:', e);
    return { ok: false, status: 502, error: 'Could not reach GitHub to start the backup' };
  }
}
