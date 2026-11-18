# Milestone 2 — CLI Restore Tooling and Hardening

Started November 10, 2026, following completion of Milestone 1 project acceptance. The funded scope is the second milestone of Phase One; its acceptance remains a published CLI for Linux, macOS and Windows and a verifiable restore demonstration on CKB Testnet. The broader product roadmap in `PHASES.md` includes work outside this grant milestone.

## Intended installed experience

Users install Rivet once on Windows, Linux or macOS, authenticate once, and run the `rivet` command from their own project directories. They should not need the Rivet source checkout or a `node packages/cli/src/cli.mjs` command. This is a CLI; a separately importable programming SDK is not currently implemented.

The implemented development-package workflow is:

```sh
rivet login
cd my-project
rivet backup
rivet status
rivet restore owner/repository --mode exact --target ../recovered.git
```

Backup and status infer `owner/repository` from the current project's GitHub origin, while retaining explicit repository arguments. Restore works when the original directory is gone, using an explicit repository or an exported recovery file, and preserves existing files by restoring into a new destination. Exact restore creates a bare mirror; the [CLI guide](../packages/cli/README.md) explains cloning it into a working tree.

`pnpm cli:pack` builds an installable npm archive and SHA-256 file in `dist/`. The package includes all runtime modules and runs outside the Rivet checkout with Node 24+ and Git. Login uses a hidden GitHub personal-token prompt, validates the existing Rivet account, and saves credentials for that server origin. Logout removes the saved credential. `RIVET_TOKEN` and `RIVET_URL` remain optional session overrides; browser OAuth and OS keychain storage are still pending.

The new `GET /api/cli/account` endpoint must be deployed with the CLI update. The standalone Linux executable builds and passes the installed workflow, including attribution and saved mapping-anchor recovery. Hosted rollout, public release publication, and real macOS/Windows runs remain pending until release CI records them. Package tests use simulated network responses and do not claim a live backup or restore.

Current testnet backups cover public GitHub repository history fetched by a hosted worker. Running a command inside a local project must not imply that unpushed commits, uncommitted files, arbitrary local directories, or private repositories have been backed up. A local upload pipeline would be additional implementation work and must have an explicit scope before being claimed.

## Delivery order

| Step | Deliverable | Current state / completion evidence |
| --- | --- | --- |
| 1 | Independent exact restore and stronger anchors | Source implementation supports legacy and v2 proofs. V2 binds commits, refs, bundle SHA-256, CID and count. Automated encrypted recovery deletes the source repository before restoring commits, branches and annotated tags; tampering and existing targets are rejected. Worker tests cover legacy-cell enlargement and one successor per backup. Live acceptance remains pending. |
| 2 | Installed CLI workflow | Implemented development archive, saved token login/logout, server-scoped credentials, GitHub-origin detection, and default exact restore from an account proof. The package smoke test installs into a temporary global prefix and exercises a separate project, with network fixtures. Platform runs, publication and hosted acceptance remain pending. |
| 3 | Attribution restore | Implemented email-only `git-filter-repo` rewriting, complete signed mappings, trusted owner-key verification, deterministic independent replay, and a separate mapping-anchor command with saved signed receipts. The exact original mirror is retained. Installed-command and tampering checks pass. Live testnet acceptance remains pending. |
| 4 | RPC and Auto Sync hardening | Implemented bounded transient-read retries, durable signed backup checkpoints, saved-hash reconciliation, current-head reservation, repository coalescing, webhook-delivery deduplication and idempotent callbacks. Pushes during an active job request one follow-up; existing webhook secrets/activation are refreshed and pagination is handled. PostgreSQL concurrency and failure checks pass. Hosted rollout remains pending. |
| 5 | Cross-platform distribution | Versioned npm archives and native executable/checksum builds are implemented. Linux native installation and all recovery commands pass outside the checkout. Release CI builds and exercises Linux, macOS and Windows and publishes only after all pass; platform results and publication remain pending until recorded. |
| 6 | Hosted and testnet acceptance | Demonstrate installation → login → backup from a project directory → status/recovery export → independent verification → exact restore → attribution restore from a published release. Collect transaction links, release URLs and reviewer reproduction steps. |

## Acceptance run to record

1. Back up an owner-authorized public repository with multiple branches and an annotated tag; record the v2 anchor transaction, CID, output and block height.
2. Export the private recovery file outside version control. Use independent RPC/IPFS sources and then a locally saved encrypted bundle.
3. Recover into a new bare mirror while the original repository and Rivet are unavailable. Compare all commit IDs and refs and run `git fsck`. Check wrong keys, changed bundles, modified recovery commitments and existing destinations fail.
4. Repeat backup and verify that the successor consumes the previous anchor. Record occupied-capacity changes and fees separately. Check an uncertain submission is reconciled before retrying.
5. Perform attribution restore from that exact snapshot, verify every mapping and the owner's signature, and verify the mapping's separate testnet anchor.
6. Run published artifacts on Linux, macOS and Windows and retain their hashes, platform results and proof-verification output.

Local tests do not close the live or platform-release requirements. No deployment, treasury spend, published release or Milestone 2 completion is recorded by this kickoff.

## Kickoff validation — November 10, 2026

Six CLI tests passed, including independent v2 recovery after source deletion and rejection of bundle/ref/CID/count changes. The web suite passed 152 checks with zero failures and 13 environment-dependent skips. TypeScript checking, the production build, worker syntax checks and Git whitespace checks passed. The existing RPC tests require localhost sockets; they passed after granting that access for the test run. PostgreSQL/deployed-script integration checks and the new Linux/macOS/Windows CI matrix were not executed as part of this local run.

## Installed workflow validation — November 10, 2026

The expanded CLI suite passes 13 tests on Linux. It covers hidden token input and cancellation, rejected sign-in, server-bound saved credentials, logout, origin detection from project subdirectories, recovery export without key disclosure, preservation of existing recovery files, legacy/v2 recovery, and an offline npm installation followed by the installed command's full workflow. That smoke test removes the source project before authenticated restore, then logs out and verifies an exported proof without reading credentials. Network responses are fixtures; no real backup dispatch or transaction is claimed.

The web suite passes 153 checks with zero failures and 13 environment-dependent skips. TypeScript and the production build pass, including the new CLI account route. Localhost RPC checks and package subprocess checks needed execution outside the restricted sandbox. macOS/Windows execution, deployed-script/PostgreSQL integration checks, hosted login and live restore acceptance remain pending.

The local build produces `dist/rivet-cli-0.1.0.tgz` and `dist/rivet-cli-0.1.0.tgz.sha256`. Its SHA-256 is `fd4ec6aba075df99d8cdfa99eb79b364e378ec9597c96a2f0bb9096aeaa54c9e`. The archive contains the runtime modules, package metadata, guide and license; it excludes tests, fixture credentials and the web application. Generated artifacts are ignored by Git and have not been published.

Implementation references: [CLI guide](../packages/cli/README.md), [anchor v2 specification](./BACKUP_ANCHOR_V2.md), [proposal checklist](./PHASE_ONE_MILESTONES.md), [release checks](../.github/workflows/checks.yml).

## Implementation validation — November 18, 2026

Attribution restore, independent signed-mapping verification, testnet mapping anchoring with resumable signed receipts, pushed-ref monitoring, read retries, durable backup checkpoints, webhook deduplication/coalescing, current-head reconciliation and callback replay protection are implemented. The [mapping specification](./ATTRIBUTION_PROOF.md), [CLI guide](../packages/cli/README.md) and [worker rollout/recovery guide](./WORKER_SETUP.md) document the commands and operational changes.

Nineteen CLI checks pass, including actual npm installation and commands outside the source checkout. The Linux standalone executable passes login, backup/status/recovery export, exact restore after deleting the source, logout/independent verification, attribution restore, saved mapping-anchor recovery and independent mapping/anchor verification against local HTTP fixtures. The full web suite passes 193 checks with zero failures and five optional deployed-script checks skipped; PostgreSQL integration is enabled. TypeScript and the production build pass. The additive worker-job SQL also applies successfully to the disposable database. No test claims a live transaction or a real hosted backup.

The project owner explicitly deferred hosted deployment on November 18. Hosted account/job routes, additive production schema rollout, live backup/restore/mapping-anchor demonstrations and consolidated live evidence remain open. Platform release results are recorded when the release workflow finishes. Milestone 2 and funded Phase One remain open until that live acceptance passes.

The project owner approved GitHub publication on November 18. Preview tag `cli-v0.1.0-rc.1` was pushed through the existing SSH authentication; the workflow credential does not have Git write permission. Linux and Windows build and installed-command acceptance passed. macOS exposed a test comparison between `/var` and `/private/var`; the assertion now compares real paths. Release checks also exposed an unpatched picomatch advisory through an unused React Native WebRTC adapter. Removing that browser-unused dependency chain restores the production audit gate, with the existing low upstream wallet advisory still reported. The corrected candidate is `cli-v0.1.0-rc.2`; publication and platform results are recorded after CI. Hosted deployment remains deferred.
