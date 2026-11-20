# Private worker setup

Customer backups and restores must run in a **separate private repository**. The public `jedi-dtechmaker/Rivet` repository is for source, CI and releases. Customer progress is displayed inside Rivet; users do not receive worker URLs or need access to the worker repository.

On November 20, 2026, both customer worker workflows in the public repository were disabled using GitHub's API. Release checks and CLI releases remain enabled. Existing public run history remains visible until an operator removes it. Keep those public workers disabled.

The app requires explicit private worker coordinates and verifies `private: true`, `visibility: private` and the expected repository name with GitHub on every dispatch. Missing credentials, a failed lookup or public/internal visibility stops dispatch **before** reserving a job or sending customer inputs. The workflows also skip their jobs in public repositories. The old `RIVET_REPO_*`, `PROOF_REPO_*` and `VERCEL_GIT_REPO_*` coordinates are no longer worker fallbacks.

## Create the private worker repository

1. Create an empty **private** GitHub repository, for example `jedi-dtechmaker/rivet-workers`. Do not make it a fork of the public repository.
2. Copy only `.github/workflows/backup.yml` and `.github/workflows/restore.yml` from this source checkout into the new repository, preserving those paths, and commit them to its default branch. Do not copy release workflows or application secrets into files.
3. In the private repository's **Settings → Secrets and variables → Actions → Variables**, set:

   ```dotenv
   RIVET_SOURCE_REPO=jedi-dtechmaker/Rivet
   RIVET_SOURCE_REF=<full commit SHA containing this privacy/progress fix>
   ```

   Use the commit deployed to Vercel. The workflows check out that public source revision with checkout credentials disabled. After future worker changes, update this pinned revision deliberately.
4. Under **Actions secrets** in that private repository, configure `PINATA_JWT`, `TREASURY_PRIVATE_KEY` and `BACKUP_CALLBACK_SECRET`. Use the same callback secret in the app's server environment. Existing installations can temporarily use matching `NEXTAUTH_SECRET` values, but a dedicated callback secret avoids sharing the sign-in secret with workers.
5. Confirm Actions is enabled in the private repository. Its maintainers can inspect runs; ordinary Rivet users and public source contributors do not need access.

Private Actions usage may consume your account's included minutes and paid allowance. Review the account's usage settings before resuming workers. A private worker repository is the interim host until the VPS phase; neither host requires your personal computer to stay on.

## Configure the dispatch token and Vercel

1. Create a fine-grained GitHub token owned by an account with access to **rivet-workers**, selecting only that private repository. Grant **Actions: Read and write**; **Metadata: Read** is also required for the visibility check. Users' sign-in tokens never replace this operator credential.
2. Configure these **server environment variables** on the existing Vercel project and in local development when needed:

   ```dotenv
   GH_DISPATCH_TOKEN=<token with access to the private worker repo>
   RIVET_WORKER_REPO_OWNER=jedi-dtechmaker
   RIVET_WORKER_REPO_NAME=rivet-workers
   RIVET_WORKER_REPO_REF=main
   NEXT_PUBLIC_APP_URL=https://rivet-web-ten.vercel.app
   BACKUP_CALLBACK_SECRET=<same secret as the private workers>
   RIVET_WORKERS_ENABLED=false
   ```

   Keep credentials out of chat, Git and `NEXT_PUBLIC_` variables. Adjust the branch and canonical app URL if your deployment differs. Do not point the new variables at the public Rivet repository.
3. Apply `pnpm --filter @rivet/web run workers:setup` against the deployment database **before** deploying this version. This adds `WorkerDispatch.progress` with default zero and preserves existing records and signed checkpoints. Deploy the app from the same source revision configured in `RIVET_SOURCE_REF`.
4. Set `RIVET_WORKERS_ENABLED=true` and redeploy only after the private workflows, credentials and callback URL are configured. Then perform one small public-repository backup from the app. Confirm the private worker receives the run, the public repository receives no customer run, and the card advances to 100% after confirmation.

Until this setup is complete, new backup/restore requests return an error. Existing saved backups, verification and local recovery remain available. A new Vercel project or public URL is unnecessary.

Rollout preparation on November 20, 2026: the live database's additive `progress` column was applied and verified in one transaction. Account, repository, dispatch and signed-checkpoint counts were unchanged. The private repository and Vercel worker variables still need configuration. The prepared branch passed 202 web tests (5 optional tests skipped), TypeScript checking and the production build, including local PostgreSQL migration and progress tests.

## Customer progress

The backup worker reports cloning, history checks, bundling, encryption, upload, proof preparation and confirmation to the shared-secret authenticated job endpoint. Reports can advance an active job's percentage; they cannot regress it, change a signed checkpoint or mark a job completed. Stage percentages are estimates rather than byte counts or remaining-time predictions. Progress updates are best effort so a temporary display outage cannot interrupt a signed backup.

The signed-in user polls the exact account-owned job. Responses contain only status, estimated percentage, a stage label and the confirmed transaction hash on completion. A different account cannot inspect the job, and responses are private and not cached. Only the confirmed completion protocol produces 100%. Failed jobs stop the spinner and show a retry message; prepared jobs retain their saved transaction for reconciliation.

## Callback and worker prerequisites

- `backup.yml` and `restore.yml` must exist on the private repository's default branch. `RIVET_WORKER_REPO_REF` identifies that repository's branch or revision; `RIVET_SOURCE_REF` identifies the app source revision to execute.
- Workers call `NEXT_PUBLIC_APP_URL/api/backup/callback`. For local development, use a public tunnel to port 3000; hosted workers cannot call localhost. Keep `NEXTAUTH_URL=http://localhost:3000` for local sign-in.
- Private **customer repository** backups remain disabled on testnet. This restriction is separate from the mandatory private **worker repository**. The app verifies public customer repository visibility and write access; the backup worker clones it without user credentials.
- Restores require a completed public backup belonging to the signed-in account. The requesting user's token is needed to create their restored repository and is forwarded only to the private worker. Previously stored private backups require operator-assisted recovery.

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

Hosted rollout update — November 20, 2026: the project owner merged the prepared branch into `main`, and Vercel recorded a successful production deployment for commit `89f3f62af5477aed20c046b4276f424d2cb74715`. No backup/restore workers were active or queued before schema application. The additive SQL was applied as one transaction over the configured Neon database's HTTPS query endpoint after matching an existing confirmed backup against the live API. All expected columns were independently verified and existing account, repository and job counts were unchanged. The published CLI passed live login, existing-backup status and logout. A new backup/restore and mapping-anchor acceptance run remains pending; the local `.env` callback URL is a development tunnel and is not evidence of the hosted environment's callback setting.

A repository has one active queued/prepared job under the existing PostgreSQL advisory lock. Reservation reads the current saved anchor head; stale caller snapshots do not start a second chain. Repeated webhook delivery IDs resolve to their original job. New pushes during an active job mark it for one follow-up, dispatched from the confirmed successor with a stable delivery ID.

Before broadcasting, the worker saves the signed transaction, proof result and private recovery material through the authenticated job endpoint. A resumed worker reads that checkpoint first, checks the saved hash on CKB, and reuses its exact signed bytes if submission is needed. Confirmation updates the repository only when its predecessor still matches; completed callback replays acknowledge the saved result without overwriting newer backups. Checkpoints and encryption material stay in private server storage and must not be uploaded as public Actions artifacts.

For an interrupted or uncertain run, rerun the same Actions run. If GitHub never created a run after a lost dispatch response, manually dispatch `backup.yml` with the existing job ID, original repository and configured callback URL. The authenticated job endpoint provides the saved predecessor/checkpoint; the workflow input cannot replace it. Do not create another job ID, clear a prepared reservation or rebuild its transaction to bypass a pending submission. Definitive failures before signing can be replaced through an ordinary new backup. A prepared transaction that is rejected or conflicts with an external spend needs operator reconciliation of its saved inputs; it is intentionally retained.

Read requests retry bounded transient outages/rate limits. Workflow creation and transaction sends are not blindly retried. Callback and checkpoint writes are replay-safe. Existing hook setup reactivates hooks, refreshes their shared secret and follows GitHub pagination with bounded concurrency.

Release artifacts are built by `.github/workflows/cli-release.yml`. A `cli-v*` tag runs package and native tests on Linux, macOS and Windows; only a fully passing matrix can publish the preview release. These fixture/platform runs do not replace the live testnet acceptance in `MILESTONE_TWO_PLAN.md`.
