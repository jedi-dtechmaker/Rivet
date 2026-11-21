# Rivet — Milestone 2 Delivery Report and Phase One Completion Update

**CLI Restore Tooling and Hardening · CKB Testnet · November 21, 2026**

Implementation and project acceptance testing for Rivet’s second grant milestone are complete and ready for community review. Milestone 2 delivers an installable CLI for Linux, macOS, and Windows; independent exact recovery; attribution recovery with signed commit mappings; a separate mapping anchor on CKB Testnet; and improvements to RPC handling, backup jobs, and Auto Sync reliability.

The live acceptance run backed up a public repository twice, verified the successor-anchor lifecycle, recovered its original commits and refs, reproduced an attribution rewrite, and confirmed the signed mapping’s separate testnet anchor. The published CLI was then installed and exercised outside the Rivet checkout against that real backup and mapping.

Together with the previously delivered onboarding, CoTA identity, and Sovereign Passport milestone, this completes implementation and project acceptance for the funded Phase One scope. This report requests community review and milestone sign-off; it does not claim that external review has already been completed.

- Repository: [jedi-dtechmaker/Rivet](https://github.com/jedi-dtechmaker/Rivet)
- Hosted application: [rivet-web-ten.vercel.app](https://rivet-web-ten.vercel.app/)
- Published CLI: [cli-v0.1.0-rc.3](https://github.com/jedi-dtechmaker/Rivet/releases/tag/cli-v0.1.0-rc.3)
- Funded proposal and discussion: [Rivet: Decentralized GitHub Backup, Timestamping and Restore on CKB](https://talk.nervos.org/t/dis-rivet-decentralized-github-backup-timestamping-and-restore-on-ckb/10739)
- Previous delivery: [Milestone 1 report](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/PROGRESS_UPDATE_2026-10-30.md)
- Milestone checklist: [Phase One milestones](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/PHASE_ONE_MILESTONES.md)
- Detailed acceptance: [November 21 live acceptance record](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md)
- Public evidence: [proofs, comparisons, release checks, and signed mapping](https://github.com/jedi-dtechmaker/Rivet/tree/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21)

## Milestone 2 deliverables

The proposal’s acceptance requirement is a published CLI and a restore flow verifiable on CKB Testnet. The delivered work maps to that scope as follows:

| Deliverable | Delivered behavior | Verification |
| --- | --- | --- |
| Cross-platform CLI | Installable npm archive and standalone Linux x64, macOS arm64, and Windows x64 executables, with SHA-256 files. | All platform build and installed-command checks passed; every public archive/executable was downloaded and matched its published checksum and GitHub asset digest. |
| Backup, status, and verification | `rivet backup`, `rivet status`, and `rivet verify`, with GitHub-origin detection, saved login, and private recovery-file export. | Hosted backups, public-chain verification, and published-release login/status/logout passed. |
| Exact restore | Recover a new bare Git mirror while preserving original commit IDs, branches, and annotated tag objects. | All three source commits and all three refs matched; Git integrity checks passed. |
| Attribution restore | Remap selected emails through `git-filter-repo`, retain an exact original mirror, and sign the complete commit mapping. | Independent replay reproduced every commit mapping and rewritten ref; owner signature verification passed. |
| Mapping proof | Bind the signed attribution document to a separate CKB Testnet cell. | Mapping transaction confirmed in block 23131676; the public npm CLI and Linux executable verified it. |
| Hardening and documentation | Bounded read retries, durable signed checkpoints, job deduplication/coalescing, replay-safe callbacks, and installation/recovery guides. | Automated failure/concurrency checks, real hosted backup runs, deployment checks, and published evidence. |

## The complete user process

### 1. Install Rivet once

The release is distributed through GitHub Releases. The npm archive requires **Node.js 24+ and Git**. Standalone executables include Node, while Git is still required. Attribution restore additionally requires Python 3 and `git-filter-repo` 2.47.0.

With Node and Git installed:

```sh
npm install --global https://github.com/jedi-dtechmaker/Rivet/releases/download/cli-v0.1.0-rc.3/rivet-cli-0.1.0.tgz
rivet --version
rivet --help
```

The command reports `rivet 0.1.0`; `cli-v0.1.0-rc.3` identifies this published preview build. Installation does not require cloning the Rivet source repository.

Developers can instead download the executable for their platform and its accompanying `.sha256` file. The [release page](https://github.com/jedi-dtechmaker/Rivet/releases/tag/cli-v0.1.0-rc.3) and [CLI guide](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/packages/cli/README.md) explain checksum verification and installation. macOS binaries use ad-hoc signing without Apple notarization; Windows binaries do not have a publisher certificate.

### 2. Sign in and back up a public repository

First sign into the hosted Rivet website with GitHub to register the account. Then sign into the installed CLI:

```sh
rivet login
cd /path/to/my-public-project
rivet backup
rivet status --proof-out /private/location/project-recovery.secret.json
```

Login uses a hidden GitHub personal-token prompt and validates the existing Rivet account. Saved credentials are scoped to the selected server origin. The token is not passed as a command-line argument or forwarded to the backup worker.

From a project directory, Rivet detects `owner/repository` from the GitHub `origin` remote. An explicit argument such as `rivet backup owner/repository` also works. The hosted worker mirrors the pushed repository, creates and encrypts its Git bundle, uploads it to IPFS, and anchors its commitments on CKB Testnet. The CLI waits for a newly confirmed backup and reports the transaction, CID, and block height.

This backup covers **public GitHub history already pushed to GitHub**. Unpushed commits, uncommitted files, arbitrary local folders, and private repositories are outside the current hosted backup scope. A connected wallet is not required for this public-backup flow.

The exported recovery file includes the decryption material needed for independent recovery. Keep it in a protected location outside version control. Existing recovery files are not overwritten, and normal command output omits recovery keys. Replace the example paths with private locations on your computer.

### 3. Verify and recover without a Rivet login

With the exported recovery file retained, verification and recovery can run after logout and from another directory:

```sh
rivet logout
rivet verify --proof /private/location/project-recovery.secret.json
rivet restore --mode exact \
  --proof /private/location/project-recovery.secret.json \
  --target ./recovered.git
git -C ./recovered.git fsck --full --strict
git clone ./recovered.git ./working-copy
```

Exact restore creates a new **bare mirror**. Cloning that mirror creates an ordinary working directory. Existing restore destinations are rejected, including empty directories, so an existing project is preserved.

Independent recovery uses the exported proof, CKB Testnet RPC, the encrypted bundle from IPFS or a saved local copy, and Git. It does not require fetching the original GitHub repository or reading saved Rivet login credentials. The CLI checks the confirmed anchor and authenticated bundle before accepting the recovered history.

For a different public gateway or a retained encrypted bundle, use `--gateway https://gateway.pinata.cloud/ipfs/` or `--bundle /private/location/encrypted.bundle`. A recovery file and available bundle must be retained; public blockchain commitments alone cannot decrypt the repository.

### 4. Recover attribution while retaining the original

Attribution restore creates a separate rewritten mirror. Install its additional tool dependency:

```sh
python -m pip install git-filter-repo==2.47.0
rivet keygen --out /private/location/owner-key.pem
```

Prepare an email mapping at `/private/location/emails.json`, for example:

```json
[{ "from": "old@example.com", "to": "new@example.com" }]
```

Then restore into a new destination:

```sh
rivet restore --mode attribution \
  --proof /private/location/project-recovery.secret.json \
  --email-map /private/location/emails.json \
  --signing-key /private/location/owner-key.pem \
  --target ./attribution-recovery
```

The result contains:

- `original.git`: the exact verified original mirror.
- `rewritten.git`: the mirror with the selected author, committer, and tagger email changes.
- `mapping.json`: the owner-signed document linking every original reachable commit to its rewritten counterpart and committing the rewritten refs.

Rewriting changes commit IDs and removes original commit/tag signatures from the rewritten copy. The original mirror preserves those objects. Independent verification reproduces the rewrite and checks the complete mapping, refs, and owner signature. Email remapping does not establish original authorship or guarantee GitHub contribution-graph eligibility.

### 5. Verify the signed mapping and anchor it separately

Verify the mapping using the owner’s trusted public key:

```sh
rivet verify-mapping \
  --mapping ./attribution-recovery/mapping.json \
  --owner-key /private/location/owner-key.pem.pub \
  --proof /private/location/project-recovery.secret.json \
  --target ./attribution-recovery/rewritten.git
```

A reviewer needs the owner’s public key through an established channel. An embedded key by itself does not identify its owner. The live demonstration’s public key and fingerprint are published in the repository evidence linked below.

The signed mapping can be anchored with an owner-authorized, funded CKB **testnet** key:

```sh
rivet anchor-mapping \
  --mapping ./attribution-recovery/mapping.json \
  --owner-key /private/location/owner-key.pem.pub \
  --ckb-key-file /private/location/testnet-key \
  --receipt-out /private/location/mapping-anchor.json
```

This creates a separate mapping cell and spends test CKB. The command saves its signed transaction before broadcasting. An interrupted operation resumes with the same receipt and transaction hash. The mapping anchor leaves the repository’s backup anchor independent.

To verify the confirmed mapping, repeat `rivet verify-mapping` with `--anchor 0xYOUR_MAPPING_TRANSACTION --output-index 0`. The verifier checks the source backup, reproduces the rewrite, verifies the signature, and checks the mapping digest against the committed transaction and its block header.

## The live testnet demonstration

The acceptance repository was [jedi-dtechmaker/DEXsol-skannar](https://github.com/jedi-dtechmaker/DEXsol-skannar). Its snapshot contained **three commits, two branches, and one annotated tag**. The acceptance branch and tag point to existing history.

Two new v2 backups were confirmed. The first replaced an existing legacy anchor; the second consumed the first v2 anchor and created its successor. Public RPC checks verified exactly one backup successor per transition, capacity changes, and fees.

| Operation | Confirmed transaction | Block | Anchor capacity | Network fee |
| --- | --- | --- | --- | --- |
| Existing legacy backup | [f038aeb4…](https://pudge.explorer.nervos.org/transaction/0xf038aeb4d3a1c520fce05fc3df61f3635ca864f5e99a21adddbec3e635e4d12f) | 22986143 | 93 test CKB | Historical baseline |
| First v2 backup | [8bb202bc…](https://pudge.explorer.nervos.org/transaction/0x8bb202bcf2bb9915f646ba2aa6bf4294a10da11a8eb892ff3daa434063d4d145) | 23131379 | 225 test CKB | 0.00000672 test CKB |
| Second v2 backup | [707f7244…](https://pudge.explorer.nervos.org/transaction/0x707f7244eb11df3e8928a0d490dafee3d315220ffa0db575f03b508b654b9d65) | 23131463 | 225 test CKB | 0.00000672 test CKB |
| Separate mapping anchor | [09e362fc…](https://pudge.explorer.nervos.org/transaction/0x09e362fcb0c7c61e04a2d1266ce10cc9474a819b45b0224670171d2487251010) | 23131676 | 97 test CKB | 0.000005 test CKB |

The legacy-to-v2 transition required an additional 132 test CKB of occupied capacity. The next backup preserved that capacity. Locked capacity and transaction fees are separate: the two backup rows describe successive versions of one backup anchor, rather than two simultaneously live 225-CKB cells.

Exact and attribution recovery used the **first v2 snapshot**. The second backup establishes the successor lifecycle and is the latest snapshot returned by hosted status. The mapping document binds the recovered first snapshot; its funding input was ordinary treasury change at output 1 of the second backup transaction. The backup anchor at output 0 was left untouched. Both the mapping cell and latest backup anchor were independently checked as live during acceptance.

### Exact recovery results

The published npm CLI recovered all three original commit IDs and all three refs, including the annotated tag object. `git fsck --full --strict` passed, and the full commit/ref comparison matched.

The run used an empty credential directory, an unavailable Rivet origin, a source mirror moved out of its original path, a fetch guard permitting only CKB RPC and public IPFS gateways, and Git transport restricted to local files. These controls cover the CLI’s fetch calls and Git transport; they are not an operating-system-wide network sandbox.

- [Published-release exact recovery](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/public-release-exact-restore.json)
- [Complete commit/ref comparison and recovery controls](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/public-release-recovery-comparison.json)

### Attribution and mapping results

The demonstration remapped a source email to the reserved-domain address `acceptance@rivet.example`. Every old/new commit pair and rewritten ref was independently reproduced, and the Ed25519 owner signature verified. This demonstrates verifiable rewriting and makes no claim about GitHub’s contribution graph.

The separate mapping transaction preserved its approved hash during signing, confirmed in block **23131676**, and paid **500 shannons**. The public npm CLI and the downloaded Linux standalone executable both verified the signed mapping and its chain anchor.

- Signed mapping digest: `0xb48332694b9924e211e1e309ab5eb0662b0d755e0d25a7f90ee5829827e7d792`.
- Owner public-key fingerprint: `0x4bd3634d95988d3e07061a4be22097a7e4dae5f238e0791c974fedc02dbd83a8`.
- [Signed attribution mapping](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/attribution-mapping.json) and [owner public key](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/owner-key.pub).
- [Mapping lifecycle, funding, capacity, and fee checks](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/mapping-anchor-lifecycle.json).
- [Public npm CLI verification](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/public-release-mapping-verification.json) and [public Linux executable verification](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/public-linux-native-mapping-verification.json).

## Stronger backup proofs

The new v2 anchor binds the commit-set root, sorted refs and their object IDs, plaintext Git-bundle SHA-256, encrypted IPFS CID, and commit count. This lets recovery verify both the bundle bytes and the repository state before accepting the restored mirror.

Legacy proofs remain supported with their stated limitations: their old 32-byte anchors do not authenticate the CID, bundle SHA-256, or refs. Exporting an older proof does not upgrade it; a new backup creates a v2 commitment.

The [v2 anchor specification](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/BACKUP_ANCHOR_V2.md) and [attribution proof specification](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/ATTRIBUTION_PROOF.md) document the formats and verification boundaries.

## RPC, backup-job, and Auto Sync hardening

The reliability work includes:

- Bounded retries for transient reads, while permanent failures remain visible.
- Durable signed backup checkpoints saved before submission, with reconciliation by the saved transaction hash and reuse of the same signed bytes.
- One active reservation per repository, duplicate-delivery detection, and coalesced follow-up work when additional pushes arrive.
- Current-head checks before accepting a successor, with idempotent completion callbacks that preserve newer repository state.
- Existing webhook reactivation and secret refresh, pagination, and bounded setup concurrency.
- `rivet watch <dir>` for detecting changes to pushed GitHub refs and requesting another backup; local-only files still require pushing first.

The live run included a lost HTTP response during the second-backup request. State was inspected before a subsequent manual request through the server’s reservation/coalescing path produced the recorded second job. The detailed acceptance record preserves that sequence. Saved-transaction recovery, concurrency, and callback-replay failure paths also have automated fixture/database coverage; the live run is not presented as a demonstration of every injected failure case.

The additive worker-job database update was applied to the live deployment after draining active work and checking the database against a known confirmed backup. Expected columns were independently verified, and existing account, repository, and job counts were preserved.

The web application remains on Vercel, with GitHub Actions workers retained for the current testnet stage. Moving workers to dedicated infrastructure belongs to the separate production phase.

## Release, deployment, and validation

The [CLI release workflow](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44851633570) passed the package and native executable checks on Linux, macOS, and Windows before publishing `cli-v0.1.0-rc.3`. The separate [release checks](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44851633573) also passed. Platform jobs exercise installed commands outside the source checkout, including recovery against fixtures.

All four public archive/executable downloads matched their published SHA-256 files and GitHub asset digests. The npm archive’s SHA-256 is:

```text
301028f135be4cd10f5df31a69e386fecc30ff546f94d7b85f92e41adbd3ba0b
```

The public npm CLI additionally passed live login, confirmed-backup status, and logout using isolated temporary credentials, which were removed afterward. Live-chain recovery and mapping checks in this report ran on Linux. macOS and Windows execution is established by the platform matrix’s installed-command tests.

[Security PR #3](https://github.com/jedi-dtechmaker/Rivet/pull/3) merged as `92d648fa43970fad7b30bf4d951e19ea284c166c`. Its [main checks](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44850418650) and production deployment passed. Release CI includes dependency auditing down to low severity, web/database checks, TypeScript checking, and a production build. Dependency remediation and its SDK compatibility checks are documented in the [security maintenance guide](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/DEPENDENCY_SECURITY.md). No independent third-party security audit is claimed.

The successful live backup workers ran from the preceding deployed commit `fc43a62920db97c6bc6f1e4085442e8fddecadff`. Their results establish the backup flow. The separate production record establishes the later dependency-security rollout.

Five negative checks passed:

| Check | Observed result |
| --- | --- |
| Wrong AES recovery key | Recovery rejected. |
| Altered anchored refs commitment | Verification rejected. |
| Modified encrypted bundle | Verification rejected. |
| Tampered owner signature | Mapping verification rejected. |
| Existing restore destination | Restore rejected; existing refs remained intact. |

The [negative-check record](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/negative-checks.json), [public artifact checksums](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/public-release-artifacts.json), and [production deployment record](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/production-deployment.json) make these results reviewable.

## Verification scope and current limits

Rivet remains a **CKB Testnet preview for pushed public GitHub history**. It is a CLI, with no separately published programming SDK. Browser-based CLI login and OS keychain integration remain future work.

An anchor proves that the committed repository state existed by a CKB block height. It does not certify developer-supplied Git commit dates or original authorship. The CLI trusts the selected RPC for committed status and block headers; it is not an independent consensus or block-header-chain verifier. GitHub identity association remains a separate CoTA identity proof from Milestone 1.

IPFS availability is separate from proof validity. During acceptance, the default `ipfs.io` gateway could not serve the fresh bundle. The public Pinata gateway returned the 49,912-byte ciphertext, and independent verification passed. Recovery from the saved encrypted bundle also passed. Long-term availability requires retaining and serving the bundle.

The public evidence excludes recovery AES keys/IVs, GitHub tokens, CKB private keys, and the Ed25519 private key. Reviewers can inspect the public commitments, signatures, and transaction records; reproducing encrypted-content recovery additionally requires privately supplied recovery material or a backup of their own repository.

The final evidence is published as **repository source files**. The [SHA256SUMS manifest](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/evidence/milestone-two-2026-11-21/SHA256SUMS.json) covers the evidence files. The CLI release supplies the application downloads; this report does not depend on a separate evidence attachment being present in that release.

## Phase One completion and the next phase

The funded Phase One delivery now comprises:

- **Milestone 1:** GitHub-first onboarding, optional verified JoyID connection, sponsored user-owned CoTA identity and backup commitments, Sovereign Passport minting, and profile/verification integration.
- **Milestone 2:** Published cross-platform CLI, independent exact and attribution recovery, signed and anchored mappings, stronger v2 commitments, and RPC/Auto Sync hardening.

Implementation and project acceptance for both milestones are complete. Community review and grant sign-off are requested separately.

The proposed **Phase Two** covers dedicated hosting and domain setup, encrypted private-repository backups, durable/premium IPFS pinning, independent security review, CKB Mainnet rollout, and maintenance/scaling. Its scope, funding, schedule, and delivery milestones still need agreement. The [Phase Two plan](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/PHASE_TWO_PLAN.md) records that remaining scope. Social features and the full developer platform remain broader future roadmap work.

## Community review

Milestone 2 and the completed funded Phase One delivery are submitted for community review. Useful checks include:

1. Install the published CLI for your operating system and verify its checksum and version.
2. Back up an authorized public repository, export the private recovery file, log out, and recover into a new destination. Compare every commit and ref and run Git integrity checks.
3. Try attribution restore, retain the original mirror, independently establish the signing key, and verify the complete mapping and its separate testnet anchor.
4. Inspect the linked backup/mapping transactions and compare their data with the public proof and signed mapping records.
5. Review the recorded negative checks and report platform, recovery, gateway, or job-retry issues with reproducible details.

Existing transaction records can be inspected without creating new anchors. The [CLI self-test guide](https://github.com/jedi-dtechmaker/Rivet/blob/751a823e7bc958e885d72c0ac0cd54aa67757122/docs/CLI_SELF_TEST.md) covers fixture tests and real repository verification; the detailed acceptance record provides the historical mapping-verification command for reviewers with authorized recovery material.

Please share feedback in the proposal thread or through [GitHub Issues](https://github.com/jedi-dtechmaker/Rivet/issues). Review and sign-off on Milestone 2 and the completed Phase One delivery are requested.
