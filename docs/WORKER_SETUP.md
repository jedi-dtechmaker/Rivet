# GitHub Actions worker setup

> Current decision — November 20, 2026: continue using the existing public GitHub Actions workers temporarily. Both backup and restore workflows were re-enabled at the owner’s request. A private worker repository is not required. Workflow history remains public while this hosting arrangement continues. The future worker host will be a VPS or a managed background worker service, rather than GitHub Actions.

GitHub sign-in authorizes access to the user's repositories. Backup and restore run in the shared Rivet repository configured by `RIVET_REPO_OWNER` and `RIVET_REPO_NAME`. Starting those workflows requires Rivet's own server credential, `GH_DISPATCH_TOKEN`. Ordinary users do not need permission to administer the Rivet repository or supply a personal token.

## Configure the dispatch token

1. Sign in to GitHub as the owner of the worker repository. For this checkout, that repository is `jedi-dtechmaker/Rivet`.
2. Open [GitHub's fine-grained token settings](https://github.com/settings/personal-access-tokens/new). Name the token `Rivet worker dispatch` and choose an expiration.
3. Set **Resource owner** to the worker repository's owner. Under **Repository access**, choose **Only select repositories** and select **Rivet**.
4. Under **Repository permissions**, grant **Actions: Read and write**. Leave other permissions at their defaults; Metadata read access is included automatically. [GitHub documents Actions write access for workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
5. Generate the token and save it directly in `apps/web/.env`:

   ```dotenv
   GH_DISPATCH_TOKEN=your_generated_token
   RIVET_REPO_OWNER=jedi-dtechmaker
   RIVET_REPO_NAME=Rivet
   RIVET_REPO_REF=main
   ```

   Keep the token out of chat, source control, and `NEXT_PUBLIC_` variables. For a hosted deployment, configure it in the server environment too. If an organization requires approval, wait for approval before testing.
6. Restart `pnpm dev`, then retry **Backup Now**. A successful dispatch returns HTTP 202 and a job ID. Customer progress stays on the repository card. Operators can inspect the worker in the repository's **Actions** tab. Completing the backup also requires the callback and worker secrets below.

If GitHub returns **Must have admin rights to Repository**, verify the configured token belongs to an account with access to the worker repository and grants Actions write access. Adding OAuth scopes to users' sign-in tokens does not grant them access to Rivet's worker repository.

## Callback and worker prerequisites

- `backup.yml` and `restore.yml` must exist in `.github/workflows` on the worker repository's default branch, Actions must be enabled, and `RIVET_REPO_REF` must identify an existing branch or commit.
- The backup worker posts to `NEXT_PUBLIC_APP_URL/api/backup/callback`. For local development, set `NEXT_PUBLIC_APP_URL` to a running public tunnel that forwards to port 3000. GitHub-hosted workers cannot call your machine's localhost directly. Keep `NEXTAUTH_URL=http://localhost:3000` for local sign-in.
- Configure `PINATA_JWT` and `TREASURY_PRIVATE_KEY` in the worker repository's Actions secrets. Its `BACKUP_CALLBACK_SECRET` must match the app's `BACKUP_CALLBACK_SECRET`; if omitted, the app and worker both fall back to the same `NEXTAUTH_SECRET`.
- Private repository backups and restores are disabled on testnet. Interactive backups use the session token to verify public visibility and repository write access; the token is not forwarded to backup Actions runs. Workers independently verify public visibility and clone without credentials. Webhooks use the account already registered for the repository, including collaborator pushes, and never fall back to an arbitrary user.

The dispatch token starts jobs in Rivet's repository. It does not replace the requesting user's token for creating a restored repository under their account. Restores require a completed public backup belonging to that account. Previously stored private backups require operator-assisted recovery and must not be made public to bypass this restriction.


## Backup progress

The prepared `fix/private-workers-and-progress` branch restores an estimated percentage and stage label inside Rivet and removes customer-facing Actions links. It uses the existing worker coordinates and dispatch credential, including the Vercel defaults and legacy aliases. Merging it does not require another GitHub repository or a new hosting account.

The worker reports cloning, history checks, bundling, encryption, upload, proof preparation and confirmation through the shared-secret authenticated job endpoint. Reports advance an active job's percentage without regressing it, changing its signed checkpoint or marking it complete. Only confirmed completion produces 100%. Updates are best effort so a display outage cannot interrupt the backup.

Signed-in users can poll only their account-owned jobs. Responses include status, estimated percentage, a stage label and the confirmed transaction hash on completion. They contain no recovery keys or worker URLs, and use private, uncached responses.

The additive `WorkerDispatch.progress` column was applied and verified on the live database on November 20, 2026. Account, repository, dispatch and signed-checkpoint counts were preserved. Future installations should run `pnpm --filter @rivet/web run workers:setup` before deploying this branch.

Removing an Actions link does not make public workflow history private. The owner accepted continuing with that visibility temporarily while preparing the hosting move.

## Future hosting direction

Recommended starting architecture: keep the website and API on Vercel, move backup/restore execution to one Linux VPS with a durable queue, and keep the current database and IPFS providers initially. Jobs must continue to use account ownership checks, resource limits, saved signed checkpoints, idempotent completion and authenticated progress. GitHub remains the source host; customer operations should no longer dispatch Actions workflows after migration.

Start VPS sizing discussions at 2 vCPU and 4 GiB RAM with enough temporary disk for the largest permitted repository. Validate actual memory, disk and throughput before choosing a plan, and begin with low job concurrency. A VPS requires OS updates, process supervision and monitoring. A managed container/background worker host is an alternative if reducing server administration matters more than control. Ordinary shared web hosting is a poor fit for long-running Git jobs and temporary repository storage.

Choose monthly billing initially. Annual payment is optional where the selected provider offers it; it is not a technical requirement. Provider charges for compute, traffic, storage, snapshots and managed databases must be considered separately. Select a provider and confirm its current price before provisioning. No paid hosting has been provisioned by this change.

## Updating the existing deployment

Run `pnpm --filter @rivet/web run release:setup` against the intended deployment database before serving this update. Builds no longer change database schemas. This command installs the additive identity/proof schema and the `WorkerDispatch` table; repeat runs preserve existing records.

Worker attempts are reserved under a PostgreSQL advisory lock before GitHub dispatch. Defaults are 10 attempts per account per rolling hour, 50 globally per rolling hour, and 200 globally per rolling day. Configure `RIVET_WORKER_USER_HOURLY_LIMIT`, `RIVET_WORKER_GLOBAL_HOURLY_LIMIT`, and `RIVET_WORKER_GLOBAL_DAILY_LIMIT` to change these budgets. Failed dispatches also consume an attempt to prevent retry loops from bypassing the budget. If quota storage is unavailable, dispatch stops. `RIVET_WORKERS_ENABLED=false` pauses new backup and restore dispatches without affecting saved proofs.

The backup workflow serializes access to its shared treasury using one concurrency group and `queue: max`, retaining up to 100 waiting runs. Monitor queued runs; work above the GitHub queue limit can be canceled. It uses Node 24 and pnpm 12.4.2, matching the release configuration. The restore worker uses mirror cloning so all original branches and tags are preserved.

Milestone 2 source workers emit [v2 backup anchors](./BACKUP_ANCHOR_V2.md). Deploy the app readers and CLI together with the worker update; older readers accept only 32-byte roots. The first v2 update consumes and enlarges the legacy anchor cell, so the treasury needs additional capacity plus fees. Later backups preserve one successor cell. No database migration is needed for this format change.

If the previous anchor is spent, malformed or unavailable, the worker stops. It also stops after an uncertain submission instead of trying a fresh cell. Before retrying, inspect the workflow's transaction and the repository's saved `ckbCellOutpoint`, recover a confirmed successor and its matching CID/recovery material, and reconcile the saved record. Do not clear the predecessor to bypass this check. Queued runs may carry a predecessor captured before an earlier run finished; durable jobs below reconcile from the saved repository head rather than trusting that input.

Auto Sync reports webhook permission/configuration failures instead of claiming success. Sign out and sign back in after this update to grant the added `admin:repo_hook` OAuth scope. The GitHub account still needs repository admin permission to manage hooks; private repositories are skipped when enabling Auto Sync.

## A completed backup disappears after refresh

The dashboard reads saved backups for the signed-in GitHub account. Rivet now registers a repository under that account before dispatching the worker, and the callback updates that existing record. It rejects unregistered callbacks instead of assigning them to an arbitrary user. Deploy the updated app before starting a new backup; the worker workflow does not need changing for this fix.

If a backup created by an older version shows **Anchored** during polling but returns to **Pending Backup** after refresh, inspect the repository record's `userId`. The old callback could attach a new repository to the first database user. Verify the requesting account before correcting that association; preserve the saved transaction hash, IPFS CID, encryption fields, cell outpoint, and completion timestamp. A display or ownership repair does not require another on-chain backup.

## Milestone 2 durable backup jobs

Deploy the new `/api/backup/job` and `/api/cli/account` routes together with the updated worker. Apply `node scripts/setup-worker-dispatch.mjs` from `apps/web` before enabling dispatch. This additive migration adds repository/state/checkpoint fields to `WorkerDispatch` and the `BackupDelivery` table. Drain existing worker runs before switching versions: legacy workers do not save the signed checkpoints required by the new callback protocol.

Hosted rollout update — November 20, 2026: the project owner merged the prepared branch into `main`, and Vercel recorded a successful production deployment for commit `89f3f62af5477aed20c046b4276f424d2cb74715`. No backup/restore workers were active or queued before schema application. The additive SQL was applied as one transaction over the configured Neon database's HTTPS query endpoint after matching an existing confirmed backup against the live API. All expected columns were independently verified and existing account, repository and job counts were unchanged. The published CLI passed live login, existing-backup status and logout. The local `.env` callback URL is a development tunnel and is not evidence of the hosted environment's callback setting.

Live acceptance completed November 21, 2026: two hosted v2 backups confirm the durable worker flow and consume-and-replace anchor lifecycle. Independent exact/attribution recovery and the separate signed mapping anchor pass. Security PR #3 is merged and deployed as `92d648fa43970fad7b30bf4d951e19ea284c166c`; its main checks and production deployment pass. Public `cli-v0.1.0-rc.3` passed all platform/tag checks, public artifact checksum checks, and Linux live recovery/login checks. The repository's [acceptance record](./MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md) distinguishes the worker runs from the later security deployment and links the checksummed public evidence.

A repository has one active queued/prepared job under the existing PostgreSQL advisory lock. Reservation reads the current saved anchor head; stale caller snapshots do not start a second chain. Repeated webhook delivery IDs resolve to their original job. New pushes during an active job mark it for one follow-up, dispatched from the confirmed successor with a stable delivery ID.

Before broadcasting, the worker saves the signed transaction, proof result and private recovery material through the authenticated job endpoint. A resumed worker reads that checkpoint first, checks the saved hash on CKB, and reuses its exact signed bytes if submission is needed. Confirmation updates the repository only when its predecessor still matches; completed callback replays acknowledge the saved result without overwriting newer backups. Checkpoints and encryption material stay in private server storage and must not be uploaded as public Actions artifacts.

For an interrupted or uncertain run, rerun the same Actions run. If GitHub never created a run after a lost dispatch response, manually dispatch `backup.yml` with the existing job ID, original repository and configured callback URL. The authenticated job endpoint provides the saved predecessor/checkpoint; the workflow input cannot replace it. Do not create another job ID, clear a prepared reservation or rebuild its transaction to bypass a pending submission. Definitive failures before signing can be replaced through an ordinary new backup. A prepared transaction that is rejected or conflicts with an external spend needs operator reconciliation of its saved inputs; it is intentionally retained.

Read requests retry bounded transient outages/rate limits. Workflow creation and transaction sends are not blindly retried. Callback and checkpoint writes are replay-safe. Existing hook setup reactivates hooks, refreshes their shared secret and follows GitHub pagination with bounded concurrency.

Release artifacts are built by `.github/workflows/cli-release.yml`. A `cli-v*` tag runs package and native tests on Linux, macOS and Windows; only a fully passing matrix can publish the preview release. These fixture/platform runs do not replace the live testnet acceptance in `MILESTONE_TWO_PLAN.md`.
