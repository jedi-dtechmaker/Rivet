# Milestone 2 — CLI Restore Tooling and Hardening

> Worker hosting update — November 20, 2026: the owner chose to continue with the existing GitHub Actions workers temporarily. Backup and restore workflows were re-enabled. Their run history remains public until workers move to a VPS or managed worker host. The progress fix is on `fix/private-workers-and-progress`; no private worker repository is required. See [WORKER_SETUP.md](WORKER_SETUP.md).

Started November 10, 2026, following completion of Milestone 1 project acceptance. The funded scope is the second milestone of Phase One; its acceptance remains a published CLI for Linux, macOS and Windows and a verifiable restore demonstration on CKB Testnet. The broader product roadmap in `PHASES.md` includes work outside this grant milestone.

Completed November 21, 2026: Milestone 2 implementation and project acceptance pass. The [live acceptance record](./MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md) documents the public `cli-v0.1.0-rc.3` release, production deployment, exact/attribution recovery, confirmed mapping anchor, and checksummed evidence published as GitHub source files. Funded Phase One project delivery is complete; community/reviewer sign-off remains separate. The remaining proposed scope is [Phase Two production readiness](./PHASE_TWO_PLAN.md).

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

The new `GET /api/cli/account` endpoint is deployed with the merged backend and live database update. Preview `cli-v0.1.0-rc.3` is public with passing package and native executable checks on Linux, macOS and Windows. All public artifacts/checksums were independently verified. The published CLI passes live login/status/logout, exact recovery of a real v2 backup, signed attribution replay, and separate mapping-anchor verification. Fixture tests and live results are recorded separately in the acceptance evidence.

Current testnet backups cover public GitHub repository history fetched by a hosted worker. Running a command inside a local project must not imply that unpushed commits, uncommitted files, arbitrary local directories, or private repositories have been backed up. A local upload pipeline would be additional implementation work and must have an explicit scope before being claimed.

## Delivery order

| Step | Deliverable | Current state / completion evidence |
| --- | --- | --- |
| 1 | Independent exact restore and stronger anchors | Complete. Two live v2 backups prove consumed predecessors, one successor per backup, capacity changes and fees. The published CLI recovers all three commits, both branches and the annotated tag, and passes Git integrity and negative checks. |
| 2 | Installed CLI workflow | Complete. Public archive installation, saved token login/status/logout, server-scoped credentials and independent live recovery pass outside the checkout. |
| 3 | Attribution restore | Complete. Every signed commit mapping and rewritten ref is independently reproduced, the exact original mirror is retained, and the separate mapping anchor is confirmed in block 23131676 and verified by the public npm CLI and Linux executable. |
| 4 | RPC and Auto Sync hardening | Complete. Bounded read retries, durable signed checkpoints, saved-hash reconciliation, reservations/coalescing, delivery deduplication and callback replay protection pass automated concurrency/failure checks. The additive schema is deployed, real hosted backup workers pass, and the later dependency security fixes are deployed separately. |
| 5 | Cross-platform distribution | Complete. Public preview `cli-v0.1.0-rc.3` includes npm, Linux x64, macOS arm64 and Windows x64 assets/checksums. All platform build/installed-command checks pass, and every downloaded public artifact matches its published checksum. |
| 6 | Hosted and testnet acceptance | Complete. The acceptance record and repository evidence directory collect release/deployment records, backup/mapping transactions, exact/attribution verification, negative results and reviewer reproduction steps. |

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

## Published preview and hosted rollout — November 20, 2026

[Preview release `cli-v0.1.0-rc.2`](https://github.com/jedi-dtechmaker/Rivet/releases/tag/cli-v0.1.0-rc.2) is public. Its [release workflow](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44290534614) passed the full package and standalone installed-command workflow on Linux, macOS and Windows. The public npm archive installed into a clean prefix, version/help ran outside the checkout, and SHA-256 matched `b6cdcde86f05a464045305ff3c07297c23dd9eb9efa1764e81e1b65a7d38c312`.

The project owner merged the prepared branch. Vercel recorded a successful production deployment for `89f3f62af5477aed20c046b4276f424d2cb74715`, and the merge's [release checks](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44301191223) passed. After verifying the database against a live confirmed backup and finding no active/queued backup or restore workers, the additive worker-job SQL was applied transactionally. All expected columns were checked independently, with existing account, repository and worker-job counts preserved. Using isolated temporary credentials, the published CLI passed live login, existing confirmed-backup status and logout.

A newly dispatched backup, successor anchor, exact and attribution recovery, mapping anchor and consolidated live evidence remain open. These checks do not mark Milestone 2 or Phase One complete. Follow [the self-test guide](./CLI_SELF_TEST.md) for the remaining live workflow.

## Live acceptance progress — November 21, 2026

The owner selected `jedi-dtechmaker/DEXsol-skannar`. Two new v2 backups are confirmed; public RPC checks verify the legacy-to-v2 transition, consumed predecessors, exactly one successor per backup, capacity changes, and fees. Independent exact recovery preserves all three commits, both branches, and the annotated tag. Attribution recovery and signed mapping verification pass, as do five negative checks. The fixed CLI candidate also recovers the live proof outside the checkout with no saved login; its Linux/macOS/Windows artifact workflow passes.

The [live acceptance record](./MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md) contains the verified technical results. Security PR #3 is merged and deployed, `cli-v0.1.0-rc.3` is public with passing platform/tag checks, all public artifacts/checksums are verified, and the mapping transaction is confirmed in block 23131676. The public CLI passes exact recovery, signed mapping/anchor verification and live login/status/logout; the public Linux executable independently verifies the mapping/anchor. The owner selected GitHub source publication for the final evidence and owner public key. Milestone 2 and funded Phase One project acceptance are complete; community/reviewer sign-off remains separate.
