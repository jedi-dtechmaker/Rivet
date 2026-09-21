import { randomUUID } from 'crypto';

/**
 * Dispatches jobs to the Rivet GitHub Actions workers.
 *
 * Vercel serverless functions have no `git` binary, a read-only filesystem and a
 * 10-60s timeout, so all git work (backup and restore) runs in the
 * "Repo Backup Worker" / "Repo Restore Worker" workflows.
 *
 * Configuration is optional-first: on Vercel the repository coordinates and
 * deployment URL come from the platform, so the only genuinely required value is
 * a token able to dispatch the workflow.
 *
 * Both RIVET_* and PROOF_* variable names are accepted (RIVET_* wins) so older
 * deployments keep working after the rename.
 */

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type DispatchResult =
  | { ok: true; jobId: string; runUrl: string; startedAt: string }
  | { ok: false; status: number; error: string };

export function isValidRepoFullName(value: unknown): value is string {
  return typeof value === 'string' && REPO_PATTERN.test(value);
}

/** Read the first defined value among RIVET_*, PROOF_* and the Vercel default. */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function resolveWorkflowRepo(): { owner: string; name: string; ref: string } | null {
  const owner = env(
    'RIVET_REPO_OWNER',
    'PROOF_REPO_OWNER',
    'VERCEL_GIT_REPO_OWNER',
  );
  const name = env('RIVET_REPO_NAME', 'PROOF_REPO_NAME', 'VERCEL_GIT_REPO_SLUG');
  const ref = env('RIVET_REPO_REF', 'PROOF_REPO_REF', 'VERCEL_GIT_COMMIT_REF') || 'main';

  if (!owner || !name) return null;
  return { owner, name, ref };
}

/** Prefer the canonical public URL, fall back to the Vercel deployment URL. */
function resolveAppUrl(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

/**
 * Dispatch any workflow in the Rivet repository.
 * A jobId is generated and injected into the inputs automatically.
 */
export async function dispatchWorkflow(opts: {
  workflowFile: string;
  inputs: Record<string, string>;
  token?: string;
}): Promise<DispatchResult> {
  const target = resolveWorkflowRepo();

  if (!target) {
    console.error(
      '[dispatch] Cannot resolve the Rivet repository. Set RIVET_REPO_OWNER and ' +
        'RIVET_REPO_NAME if not running on Vercel.',
    );
    return { ok: false, status: 500, error: 'Workers are not configured on the server' };
  }

  if (!opts.token) {
    console.error('[dispatch] No token available to dispatch the workflow');
    return { ok: false, status: 500, error: 'Workers are not configured on the server' };
  }

  const jobId = randomUUID();

  try {
    const res = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.name}/actions/workflows/${opts.workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: target.ref,
          inputs: { ...opts.inputs, jobId },
        }),
      },
    );

    // Success is 204 No Content.
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[dispatch] ${opts.workflowFile} failed (${res.status}): ${detail}`);

      const hint =
        res.status === 404
          ? 'Workflow not found on the default branch, or the token lacks access.'
          : res.status === 403 || res.status === 401
            ? 'The dispatch token is invalid or lacks the required scope.'
            : 'GitHub rejected the workflow dispatch.';

      return { ok: false, status: 502, error: `Failed to start the worker. ${hint}` };
    }

    return {
      ok: true,
      jobId,
      runUrl: `https://github.com/${target.owner}/${target.name}/actions/workflows/${opts.workflowFile}`,
      startedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    console.error('[dispatch] Error reaching GitHub:', e);
    return { ok: false, status: 502, error: 'Could not reach GitHub to start the worker' };
  }
}

/** Start a backup job. */
export async function dispatchBackup(
  repoFullName: string,
  sessionToken?: string,
): Promise<DispatchResult> {
  const appUrl = resolveAppUrl();
  if (!appUrl) {
    console.error('[backup] Cannot resolve the app URL for the worker callback');
    return { ok: false, status: 500, error: 'Workers are not configured on the server' };
  }

  return dispatchWorkflow({
    workflowFile: env('RIVET_BACKUP_WORKFLOW', 'PROOF_BACKUP_WORKFLOW') || 'backup.yml',
    inputs: {
      repoFullName,
      callbackUrl: `${appUrl.replace(/\/$/, '')}/api/backup/callback`,
    },
    // A dedicated token is preferred (the webhook path has no user session);
    // otherwise reuse the signed-in user's OAuth token, which carries repo scope.
    token: process.env.GH_DISPATCH_TOKEN || sessionToken,
  });
}

/** Start a restore job for the signed-in user. */
export async function dispatchRestore(opts: {
  repoName: string;
  ipfsCid: string;
  targetRepoName: string;
  sessionToken: string;
}): Promise<DispatchResult> {
  return dispatchWorkflow({
    workflowFile: env('RIVET_RESTORE_WORKFLOW') || 'restore.yml',
    inputs: {
      repoName: opts.repoName,
      ipfsCid: opts.ipfsCid,
      targetRepoName: opts.targetRepoName,
      // Must be the requesting user's token: the new repo belongs to them.
      githubToken: opts.sessionToken,
    },
    token: process.env.GH_DISPATCH_TOKEN || opts.sessionToken,
  });
}
