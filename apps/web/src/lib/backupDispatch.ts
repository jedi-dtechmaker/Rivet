import { randomUUID } from 'crypto';
import { reserveWorkerDispatch } from '@/lib/worker-quota';

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
  userId: string;
  kind: 'backup' | 'restore';
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
    console.error('[dispatch] Configure GH_DISPATCH_TOKEN with Actions write access to the Rivet worker repository');
    return { ok: false, status: 503, error: 'Rivet backup and restore workers are not configured. Please contact support.' };
  }

  const jobId = randomUUID();

  if (process.env.RIVET_WORKERS_ENABLED === 'false') return { ok: false, status: 503, error: 'Backup and restore workers are temporarily paused.' };
  if (!opts.userId) return { ok: false, status: 401, error: 'Sign in before starting a worker.' };
  try {
    const quota = await reserveWorkerDispatch(opts.userId, jobId, opts.kind);
    if (!quota.allowed) return { ok: false, status: 429, error: quota.error };
  } catch {
    console.error('[dispatch] Worker budget storage is unavailable');
    return { ok: false, status: 503, error: 'Could not check the worker budget. Please retry shortly.' };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.name}/actions/workflows/${opts.workflowFile}/dispatches`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
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
      console.error(`[dispatch] ${opts.workflowFile} failed (${res.status})`);

      const hint =
        res.status === 404
          ? 'Workflow not found on the default branch, or the token lacks access.'
          : res.status === 401
            ? "Rivet's worker credential is invalid or expired. Please contact support."
          : res.status === 403
            ? 'GitHub denied Rivet permission to start the worker. Please contact support.'
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

/**
 * Start a backup job.
 * `previousOutpoint` is the repo's existing anchor cell ("0x<tx>:<index>"),
 * which the worker spends and rewrites instead of creating a new cell.
 */
export async function dispatchBackup(
  repoFullName: string,
  userId: string,
  previousOutpoint?: string | null,
): Promise<DispatchResult> {
  const appUrl = resolveAppUrl();
  if (!appUrl) {
    console.error('[backup] Cannot resolve the app URL for the worker callback');
    return { ok: false, status: 500, error: 'Workers are not configured on the server' };
  }

  return dispatchWorkflow({
    userId, kind: 'backup',
    workflowFile: env('RIVET_BACKUP_WORKFLOW', 'PROOF_BACKUP_WORKFLOW') || 'backup.yml',
    inputs: {
      repoFullName,
      callbackUrl: `${appUrl.replace(/\/$/, '')}/api/backup/callback`,
      previousOutpoint: previousOutpoint ?? '',
    },
    token: process.env.GH_DISPATCH_TOKEN,
  });
}

/** Start a restore job for the signed-in user. */
export async function dispatchRestore(opts: {
  userId: string;
  repoName: string;
  ipfsCid: string;
  targetRepoName: string;
  sessionToken: string;
  encryptionKey?: string;
  encryptionIv?: string;
}): Promise<DispatchResult> {
  return dispatchWorkflow({
    userId: opts.userId, kind: 'restore',
    workflowFile: env('RIVET_RESTORE_WORKFLOW') || 'restore.yml',
    inputs: {
      repoName: opts.repoName,
      ipfsCid: opts.ipfsCid,
      targetRepoName: opts.targetRepoName,
      // Must be the requesting user's token: the new repo belongs to them.
      githubToken: opts.sessionToken,
      encryptionKey: opts.encryptionKey ?? '',
      encryptionIv: opts.encryptionIv ?? '',
    },
    token: process.env.GH_DISPATCH_TOKEN,
  });
}
