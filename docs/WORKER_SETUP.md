# GitHub Actions worker setup

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
6. Restart `pnpm dev`, then retry **Backup Now**. A successful dispatch returns HTTP 202 and a job ID. Follow the worker run in the repository's **Actions** tab. Completing the backup also requires the callback and worker secrets below.

If GitHub returns **Must have admin rights to Repository**, verify the configured token belongs to an account with access to the worker repository and grants Actions write access. Adding OAuth scopes to users' sign-in tokens does not grant them access to Rivet's worker repository.

## Callback and worker prerequisites

- `backup.yml` and `restore.yml` must exist in `.github/workflows` on the worker repository's default branch, Actions must be enabled, and `RIVET_REPO_REF` must identify an existing branch or commit.
- The backup worker posts to `NEXT_PUBLIC_APP_URL/api/backup/callback`. For local development, set `NEXT_PUBLIC_APP_URL` to a running public tunnel that forwards to port 3000. GitHub-hosted workers cannot call your machine's localhost directly. Keep `NEXTAUTH_URL=http://localhost:3000` for local sign-in.
- Configure `PINATA_JWT` and `TREASURY_PRIVATE_KEY` in the worker repository's Actions secrets. Its `BACKUP_CALLBACK_SECRET` must match the app's `BACKUP_CALLBACK_SECRET`; if omitted, the app and worker both fall back to the same `NEXTAUTH_SECRET`.
- Private repository backups and restores are disabled on testnet. Interactive backups use the session token to verify public visibility and repository write access; the token is not forwarded to backup Actions runs. Workers independently verify public visibility and clone without credentials. Webhooks use the account already registered for the repository, including collaborator pushes, and never fall back to an arbitrary user.

The dispatch token starts jobs in Rivet's repository. It does not replace the requesting user's token for creating a restored repository under their account. Restores require a completed public backup belonging to that account. Previously stored private backups require operator-assisted recovery and must not be made public to bypass this restriction.

## Updating the existing deployment

Run `pnpm --filter @proof/web run release:setup` against the intended deployment database before serving this update. Builds no longer change database schemas. This command installs the additive identity/proof schema and the `WorkerDispatch` table; repeat runs preserve existing records.

Worker attempts are reserved under a PostgreSQL advisory lock before GitHub dispatch. Defaults are 10 attempts per account per rolling hour, 50 globally per rolling hour, and 200 globally per rolling day. Configure `RIVET_WORKER_USER_HOURLY_LIMIT`, `RIVET_WORKER_GLOBAL_HOURLY_LIMIT`, and `RIVET_WORKER_GLOBAL_DAILY_LIMIT` to change these budgets. Failed dispatches also consume an attempt to prevent retry loops from bypassing the budget. If quota storage is unavailable, dispatch stops. `RIVET_WORKERS_ENABLED=false` pauses new backup and restore dispatches without affecting saved proofs.

The backup workflow serializes access to its shared treasury using one concurrency group and `queue: max`, retaining up to 100 waiting runs. Monitor queued runs; work above the GitHub queue limit can be canceled. It uses Node 24 and pnpm 12.4.2, matching the release configuration. The restore worker uses mirror cloning so all original branches and tags are preserved.

Auto Sync reports webhook permission/configuration failures instead of claiming success. Sign out and sign back in after this update to grant the added `admin:repo_hook` OAuth scope. The GitHub account still needs repository admin permission to manage hooks; private repositories are skipped when enabling Auto Sync.

## A completed backup disappears after refresh

The dashboard reads saved backups for the signed-in GitHub account. Rivet now registers a repository under that account before dispatching the worker, and the callback updates that existing record. It rejects unregistered callbacks instead of assigning them to an arbitrary user. Deploy the updated app before starting a new backup; the worker workflow does not need changing for this fix.

If a backup created by an older version shows **Anchored** during polling but returns to **Pending Backup** after refresh, inspect the repository record's `userId`. The old callback could attach a new repository to the first database user. Verify the requesting account before correcting that association; preserve the saved transaction hash, IPFS CID, encryption fields, cell outpoint, and completion timestamp. A display or ownership repair does not require another on-chain backup.
