import { randomUUID } from 'crypto';
import { reserveWorkerDispatch } from '@/lib/worker-quota';
import { prisma } from '@/lib/db';

/**
 * Git work runs in a separately configured private worker repository.
 * Never infer the worker from the public source repository or a Vercel checkout.
 */

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type DispatchResult =
  | { ok: true; jobId: string; startedAt: string; coalesced?: boolean; dispatchUncertain?: boolean }
  | { ok: false; status: number; error: string };

export function isValidRepoFullName(value: unknown): value is string {
  return typeof value === 'string' && REPO_PATTERN.test(value);
}

/** Workflow filename aliases are retained for existing deployments. */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function resolveWorkflowRepo(): { owner: string; name: string; ref: string } | null {
  const owner = process.env.RIVET_WORKER_REPO_OWNER;
  const name = process.env.RIVET_WORKER_REPO_NAME;
  const ref = process.env.RIVET_WORKER_REPO_REF || 'main';
  if (!owner || !name || !isValidRepoFullName(`${owner}/${name}`)) return null;
  return { owner, name, ref };
}

/** Prefer the canonical public URL, fall back to the Vercel deployment URL. */
function resolveAppUrl(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

/**
 * Dispatch a workflow only after GitHub confirms the worker repository is private.
 * A jobId is generated and injected into the inputs automatically.
 */
export async function dispatchWorkflow(opts: {
  workflowFile: string;
  inputs: Record<string, string>;
  token?: string;
  userId: string;
  kind: 'backup' | 'restore';
  backup?: { repository: string; previousOutpoint?: string | null; deliveryId?: string };
}): Promise<DispatchResult> {
  const target = resolveWorkflowRepo();

  if (!target) {
    console.error(
      '[dispatch] Configure RIVET_WORKER_REPO_OWNER and RIVET_WORKER_REPO_NAME for a private repository.',
    );
    return { ok: false, status: 503, error: 'Private backup and restore workers are not configured. Please contact support.' };
  }

  if (!opts.token) {
    console.error('[dispatch] Configure GH_DISPATCH_TOKEN with Actions write access to the Rivet worker repository');
    return { ok: false, status: 503, error: 'Rivet backup and restore workers are not configured. Please contact support.' };
  }

  const jobId = randomUUID();

  if (process.env.RIVET_WORKERS_ENABLED === 'false') return { ok: false, status: 503, error: 'Backup and restore workers are temporarily paused.' };
  if (!opts.userId) return { ok: false, status: 401, error: 'Sign in before starting a worker.' };
  // Check on every dispatch, including coalesced requests. A visibility change or
  // failed lookup must never send customer activity to a public repository.
  try {
    const response = await fetch(`https://api.github.com/repos/${target.owner}/${target.name}`, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error('Worker repository lookup failed.');
    const repository = await response.json();
    if (repository.private !== true || repository.visibility !== 'private' ||
        repository.full_name?.toLowerCase() !== `${target.owner}/${target.name}`.toLowerCase()) {
      throw new Error('Worker repository must be private.');
    }
  } catch {
    console.error('[dispatch] Cannot confirm private worker repository access');
    return { ok: false, status: 503, error: 'Backups and restores are temporarily paused while private workers are configured.' };
  }
  try {
    const quota = await reserveWorkerDispatch(opts.userId, jobId, opts.kind, opts.backup);
    if (!quota.allowed) return { ok: false, status: 429, error: quota.error };
    if (quota.existing) return { ok: true, jobId: quota.existing.id, startedAt: quota.existing.createdAt.toISOString(), coalesced: true };
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
      if (res.status >= 500) return { ok: true, jobId, startedAt: new Date().toISOString(), dispatchUncertain: true };
      // Only a definitive rejection releases the repository. A timeout or 5xx may have queued the workflow.
      if (res.status >= 400 && res.status < 500) {
        try { await prisma.workerDispatch.updateMany({ where: { id: jobId, state: 'queued' }, data: { state: 'failed' } }); }
        catch { console.error('[dispatch] Could not release rejected job; reconcile', jobId); }
      }
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
      startedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    console.error('[dispatch] GitHub dispatch response is uncertain; retaining job', jobId);
    return { ok: true, jobId, startedAt: new Date().toISOString(), dispatchUncertain: true };
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
  options: { deliveryId?: string } = {},
): Promise<DispatchResult> {
  const appUrl = resolveAppUrl();
  if (!appUrl) {
    console.error('[backup] Cannot resolve the app URL for the worker callback');
    return { ok: false, status: 500, error: 'Workers are not configured on the server' };
  }

  return dispatchWorkflow({
    userId, kind: 'backup',
    backup: { repository: repoFullName, previousOutpoint, ...options },
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
