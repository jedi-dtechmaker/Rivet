# Updating the existing hosted deployment

Rivet is already deployed. This guide covers pushing the recent identity, proof, and release fixes to that deployment. Keep the existing domain, OAuth App, database, worker repository, and secrets unless intentionally changing one of them. The app continues to use CKB testnet.

## Fixed in this update

- [x] Builds run `prisma generate && next build` and never run `db push --accept-data-loss`.
- [x] Manual backups verify public visibility and repository ownership/write access through GitHub. Private backups are blocked in the API, webhook, worker, and UI. Public backup dispatch no longer forwards the user's OAuth token to Actions.
- [x] The obsolete `/api/repo/update` endpoint returns HTTP 410 and cannot overwrite another account's proofs or attach records to an arbitrary user.
- [x] Restore selects a completed backup belonging to the signed-in account before reading its encryption key. Private restores are blocked on testnet, including older stored private backups.
- [x] Restore reads `PINATA_JWT` correctly and mirror-clones the bundle to preserve all branches, tags, and commit hashes.
- [x] Worker attempts have shared PostgreSQL-backed account/hour, global/hour, and global/day limits. A database outage stops new dispatches. Backup runs serialize treasury access and queue pending work.
- [x] Auto Sync resolves the registered repository owner for collaborator pushes, skips private repositories, rejects foreign-origin setting changes, and reports GitHub webhook failures.
- [x] Node 24 and pnpm 12.4.2 are used consistently by release configuration and workflows. The root package pins pnpm; frozen-lockfile installation includes the connector patch.
- [x] Next.js is upgraded to 15.5.28 with React 19.3.1 and asynchronous route parameters. Compatible image, validation, HTTP, CSS, and shell-quoting security fixes are pinned in the workspace overrides.
- [x] GitHub Actions release checks install a disposable PostgreSQL database, run additive setup, tests, TypeScript, dependency auditing, and a production build without deployment secrets.

The production dependency audit reports no critical, high, or moderate advisories. One low-severity upstream `elliptic` advisory has no published patched version. It is a transitive dependency of the installed wallet SDK; no cryptographic implementation was substituted. Recheck advisories when dependencies change. The [Next.js advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw) and [upstream upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15) explain the framework update.

## Apply to the existing deployment

1. Back up the intended deployment database. From a release environment with `DATABASE_URL` explicitly pointing to that database, run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @proof/web run release:setup
   ```

   Setup adds missing wallet-verification, registration, proof, and worker-limit storage. It preserves users, backups, approved transactions, and identity ownership. Repeat runs are safe. It expects the existing base `User`/`Repository` schema; do not use `db push --accept-data-loss` on the deployed database. Schema setup was verified both on an existing schema and on a legacy schema with preserved backup evidence.

2. Keep the existing hosting root at `apps/web` and use Node 24. Use `pnpm build` there, or `pnpm --filter @proof/web build` from the repository root. Remove any old hosting override that explicitly runs `prisma db push`. Keep the root workspace files and `patches/` available to installation.

3. Keep the existing OAuth and worker secrets. Check only missing settings:

   | Setting | Purpose |
   | --- | --- |
   | `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` | Existing canonical HTTPS origin; callback and wallet requests must use it |
   | `COTA_SPONSOR_PRIVATE_KEY` | Dedicated funded testnet sponsor key on the server |
   | `COTA_SPONSOR_ENABLED` | Enable only after schema/funding checks |
   | `COTA_SPONSOR_MAX_REGISTRATIONS` | Intended lifetime registration budget; existing sponsored registrations count |
   | `CKB_TESTNET_RPC_URL`, `COTA_REGISTRY_URL` | Reachable testnet node/indexer and registry; defaults remain available |
   | `CKB_RPC_IP_FAMILY` | Optional; use `4` only if the hosting network needs IPv4 explicitly |
   | `RIVET_WORKERS_ENABLED` | Optional, defaults enabled; `false` pauses dispatches |
   | `RIVET_WORKER_USER_HOURLY_LIMIT` | Optional, default 10 combined backup/restore attempts |
   | `RIVET_WORKER_GLOBAL_HOURLY_LIMIT` | Optional, default 50 attempts |
   | `RIVET_WORKER_GLOBAL_DAILY_LIMIT` | Optional, default 200 attempts |

   `DATABASE_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, `GH_DISPATCH_TOKEN`, `BACKUP_CALLBACK_SECRET`, and `GITHUB_WEBHOOK_SECRET` remain your existing deployment settings. Keep the callback secret matched with Actions. The backup treasury remains the Actions secret `TREASURY_PRIVATE_KEY`, and Pinata remains `PINATA_JWT`. These keys do not go into Git or `NEXT_PUBLIC_` variables.

4. Include all intended modified and new source files, migration SQL, setup scripts, tests, root package/lock/workspace files, connector patch, and workflows in the release. `.env` and `.env.cota-sponsor.local` stay excluded. Update the worker workflows on their default branch as part of the same release; code changes are not active in the worker until pushed there.

5. Redeploy using the existing hosting project. If Auto Sync is used, sign out and sign in again to grant the added `admin:repo_hook` scope, then verify a push triggers a backup for the registered account. Failed permission checks are now shown instead of silently enabling Auto Sync.

6. On the hosted origin, verify GitHub sign-in, a public backup and authenticated callback, refresh persistence, owner-only restore, JoyID reconnection, and unchanged signed-proof sync without another fee. The host must support the identity routes' 60-second execution budget and workers must still reach the existing callback URL. Do not use the release database for integration tests.

Backup workflow concurrency uses GitHub's [documented queue behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency): one running backup and up to 100 pending runs. Attempts beyond that queue limit can be canceled. Account and global dispatch limits remain independent of CoTA registration sponsorship limits. Monitor Actions runs, IPFS usage, and both funded testnet wallets after release.

## Verified locally and remaining hosted checks

Local checks cover cross-account denial, private-repository rejection even with a forged client flag, callback persistence, exact encrypted-bundle restore, concurrent PostgreSQL quota enforcement, and repeat additive migrations preserving backup evidence. Production builds use an isolated source copy and a disposable database.

October 25 validation: 92 tests pass with all PostgreSQL integrations enabled against a disposable database, including two upgrade passes on a legacy schema. One optional contract-debugger test is skipped because its external binary/fixture is not installed in this session. TypeScript, frozen offline installation, workflow YAML parsing, and the Next.js 15.5.28 production build pass. The configured workspace database has the additive worker-limit table installed; this does not establish that another deployment database is upgraded.

The existing testnet identity registration and signed witness proof are confirmed. The proof preserves the CoTA SMT root; passport minting and the original CoTA SMT record-storage requirement remain open in [the Phase One checklist](./PHASE_ONE_MILESTONES.md). Hosted acceptance still needs to run after deployment.

No Git commit, push, or hosted deployment is performed by these local fixes. The worker table is installed in the database configured for this workspace; apply `release:setup` separately if the deployed app uses another database.
