# Rivet Phase One: Proposal Milestone Checklist

Source: [Funded proposal and discussion](https://talk.nervos.org/t/dis-rivet-decentralized-github-backup-timestamping-and-restore-on-ckb/10739).

This checklist tracks the funded Phase One proposal. Use `[ ]` for pending work and `[x]` after completion and verification. Record evidence in the completion log.

Agreed onboarding adjustment: GitHub sign-in and backups come first. JoyID onboarding is optional and starts when the user clicks **Connect Wallet** on the dashboard. Rivet creates the subsidized CoTA cell after wallet connection, rather than on first backup as originally described in the proposal.

The developer conversation motivating this flow is mapped in [sponsored CoTA onboarding](./SPONSORED_COTA_ONBOARDING.md). It distinguishes the existing optional JoyID flow from a proposed Rivet-managed CoTA tree for the earlier wallet-free stage. That candidate is local research, changes the record ownership arrangement, and does not close the pending user-owned SMT acceptance item below.

The current [engineering recommendation](./IDENTITY_DELIVERY_DECISION.md) keeps user-owned CoTA storage and targets a supported, versioned manifest representation. The full issuance/claim/update lifecycle and independent verification remain acceptance gates; the hosted experiment is not the recommended production storage model.

## Timeline and budget

Phase One runs for eight weeks from grant approval.

| Milestone | Timeline | Budget | Acceptance |
| --- | --- | --- | --- |
| 1. CoTA Onboarding and Sovereign Passport | Weeks 1–4 | $2,500 | End-to-end onboarding and passport minting live on testnet |
| 2. CLI Restore Tooling and Hardening | Weeks 5–8 | $2,500 | CLI published and restore flow verifiable on testnet |
| Total | 8 weeks | $5,000 | Both milestones delivered and verifiable on testnet |

## Milestone 1: CoTA Onboarding and Sovereign Passport

### CoTA onboarding — current focus

- [x] Implement sponsored registration transaction construction, user-owned output locks, persisted retry tracking, and sponsorship limits. Local transaction and API tests pass.
- [x] Integrate CoTA account abstraction for frictionless onboarding. Initial sponsored registration is confirmed on testnet; identity and backup SMT entries remain below.
- [x] Create the user's CoTA cell after wallet connection and verified ownership, associating it with their wallet from the start. Registration output 1 was locked to the verified JoyID wallet; the confirmed signed-proof transaction consumed it and created live replacement output 0 with the same owner and CoTA type.
- [x] Subsidize the user's CoTA cell creation through Rivet (approximately 150 CKB per user, as estimated in the proposal), without requiring the user to buy CKB. Rivet funded 150 test CKB at registration; the live replacement holds 149.99986256 test CKB after the owner's approved proof fee.
- [x] Store developer identity and backup proof in the user-owned CoTA Sparse Merkle Tree. Amentor-coder's confirmed standard metadata update commits the full 32-byte manifest root; independent verification checks identity, backup record, CoTA commitment, and backup anchor.
- [x] Complete namespaced identity/public-backup CoTA SMT updates through the supported metadata manifest protocol. Real JoyID approval and confirmed update passed on October 27. The incompatible custom extension remains retired; its diagnostic evidence is preserved.
- [x] Deliver the explicit signed-witness proof alternative on testnet. The owner-approved transaction is committed, includes developer identity and the `Amentor-coder/testing` backup proof, preserves the CoTA root, and retains the incompatible signed attempt. This does not satisfy the SMT storage requirement.

### Optional JoyID wallet connection — current focus

- [x] Preserve GitHub OAuth as the initial sign-in, registration, and repository-access flow. The backup API requires GitHub authentication and does not require a wallet; the dashboard offers wallet onboarding separately. The separate live demonstration below remains pending.
- [x] Add the dashboard **Connect Wallet** entry point for users who want to own their on-chain identity and use their CKB coins.
- [x] Integrate JoyID account creation or connection using WebAuthn and passkeys when the user chooses **Connect Wallet**. Live wallet connection and ownership signing passed.
- [x] Verify wallet ownership and link it to the signed-in GitHub user's Rivet account before CoTA creation. Verified linkage was saved on October 21, 2026.
- [x] Implement server-side JoyID ownership challenges and signature/credential verification, replacing address-only linking. Local security tests, live ownership verification, and CoTA confirmation pass.
- [x] Keep onboarding frictionless, with Rivet covering the CoTA cell capacity so users do not need to buy CKB. The sponsored activation completed through the dashboard on testnet.

### Sovereign Passport

- [ ] Implement RGB++ Spore DOB minting for the Sovereign Passport.
- [ ] Associate passport ownership with the user's connected wallet.
- [ ] Integrate the passport into the developer's public profile.

### Acceptance

- [x] Verify initial JoyID connection → signed ownership proof → sponsored CoTA registration → confirmed, user-owned live cell on testnet. Transaction evidence is in the completion log.
- [x] Automate reconnect/repeated activation, wrong-wallet rejection, concurrent record preparation, and signed retry acceptance checks with PostgreSQL.
- [x] Confirm the owner-approved signed identity/public-backup proof on testnet, verify its witness commitments against the confirmed backup anchor, and verify the replacement cell's owner, type, capacity, and preserved CoTA root.
- [ ] Complete browser disconnect/reconnect and an unchanged signed-proof sync without another transaction or fee.
- [x] Confirm the first real JoyID-approved identity/public-backup SMT update on testnet and independently verify its proof.
- [ ] Confirm browser reconnect and repeat an unchanged manifest sync without another transaction or fee.
- [ ] Complete end-to-end testing on testnet.
- [ ] Demonstrate GitHub sign-in and backup without a connected wallet.
- [ ] Demonstrate dashboard Connect Wallet → JoyID connection and ownership verification → subsidized CoTA cell → passport minting and public profile display.
- [ ] Record testnet transaction references and delivery evidence.
- [ ] Mark Milestone 1 complete after its acceptance criteria pass.

### Agreed onboarding flow

1. The developer signs in with GitHub OAuth and can back up repositories immediately without connecting a wallet.
2. Rivet mirrors repository history, computes its Merkle root, pins the Git bundle to IPFS, and anchors the proof on CKB through the existing backup flow.
3. When the developer wants to own their on-chain identity and use their CKB coins, they click **Connect Wallet** on the dashboard and create or connect their JoyID wallet using WebAuthn and passkeys.
4. Rivet verifies wallet ownership and links it to the existing Rivet account.
5. Rivet sponsors CoTA cell creation for the connected wallet. The developer's identity and backup proof are represented in the CoTA Sparse Merkle Tree by a single on-chain root.
6. The developer can mint their Sovereign Passport, owned through the connected wallet and displayed on their public profile.

Wallet connection is optional for backups. Rivet still subsidizes CoTA creation; users can use their own coins for later optional transactions. Alternate JoyID sign-in is deferred from this checklist.

### Implementation status

The dashboard connection UI, verified wallet linking, sponsored CoTA registration, standard metadata issuance, real JoyID claim, and identity/public-backup SMT update have passed on testnet for Amentor-coder. The [October 27 manifest update](https://pudge.explorer.nervos.org/transaction/0x2707eac62a37e6f7206bfdfbfa240facfbd59e1bd24f8d3eeefe9f7020f47411) is confirmed; independent public-RPC verification returns valid with one backup record and one verified backup anchor. Existing legacy backup metadata was recovered without a repeat backup. Browser reconnect/unchanged-sync acceptance, the other account's claim, Sovereign Passport minting/profile integration, and the full onboarding demonstrations remain pending. Milestone 1 stays open. See the [manifest runbook](./COTA_MANIFEST_RUNBOOK.md) and completion log below.

October 24 contract checks reproduce error 16 for the legacy extension with a valid generated passkey signature. The signed-witness builder passes both deployed JoyID and CoTA scripts, rejects proof tampering, and preserves the cell's original data. The database migration stores proof attempts separately by protocol. October 25 verification found one preserved legacy attempt and one confirmed signed-witness attempt. The committed witness matches the prepared payload, its record commitment recomputes correctly, and its backup Merkle root matches the confirmed anchor output. Browser reconnect and unchanged-sync acceptance remain pending. The last implementation checks passed 73 tests, with two disposable-database integration tests skipped, plus TypeScript and an isolated production build; these checks were not rerun for this documentation update.

## Milestone 2: CLI Restore Tooling and Hardening

### Cross-platform CLI

- [ ] Release a cross-platform CLI binary for Linux, macOS, and Windows.
- [ ] Implement `rivet backup <repo>` to trigger a mirror backup and print the CKB transaction hash and IPFS CID.
- [ ] Implement `rivet status <repo>` to show the latest anchored proof and block height.
- [ ] Implement `rivet verify <tx_hash>` to independently verify a proof against CKB and IPFS.
- [ ] Implement `rivet restore <repo> --mode exact`.
- [ ] Implement `rivet restore <repo> --mode attribution`.

### Restore modes

- [ ] Exact Restore preserves original commit hashes and the Merkle proof.
- [ ] Attribution Restore integrates `git-filter-repo` for email remapping.
- [ ] Attribution Restore generates a signed hash-mapping proof and anchors it on CKB so the rewritten history remains verifiable against the original.

### Hardening and documentation

- [ ] Add robust RPC error handling and retry logic.
- [ ] Improve Auto Sync reliability.
- [ ] Publish CLI documentation and a usage guide.

### Acceptance

- [ ] Publish the CLI for all three target platforms.
- [ ] Demonstrate the restore flow and verify its proofs on testnet.
- [ ] Record release links, testnet transactions, and delivery evidence.
- [ ] Mark Milestone 2 complete after its acceptance criteria pass.

The proposal's CLI overview also describes `rivet watch <dir>` for local repository monitoring and backups on push. It is tracked here separately because it is not listed in the detailed Milestone 2 command list.

- [ ] Deliver the `rivet watch <dir>` behavior described in the CLI overview.

## Commitments from the proposal discussion

- [x] Disable private repository backups on testnet. Manual dispatch verifies GitHub visibility and write access; webhook and worker checks also reject private repositories. Existing private restores cannot forward encryption keys through the public testnet flow.
- [x] Display a prominent explanation when a private repository is selected. Private repository cards explain the testnet restriction and do not offer backup approval.
- [x] Document the testnet privacy limitation in the deployment update guide and worker setup.
- [ ] Add a hash of sorted refs and their tip commits to the anchor payload.
- [ ] Add the Git bundle's SHA-256 to the anchor payload for byte-for-byte verification.
- [ ] Verify restored repository state without relying on the original GitHub repository or Rivet server.
- [ ] Preserve the consume-and-replace anchor cell lifecycle described in the discussion.
- [ ] Keep UI, CLI, and documentation clear that an anchor proves repository state existed by a CKB block height; it does not prove Git commit timestamps are truthful.

## Outside Phase One

The proposal reserves these items for separate Phase Two funding:

- CKB Mainnet deployment.
- Dedicated domain and VPS hosting, replacing the public GitHub Actions worker.
- Encrypted private repository support.
- Production infrastructure and premium IPFS pinning.
- Formal third-party security review.
- Long-term maintenance and infrastructure scaling.

## Completion log

| Date | Completed deliverable | Evidence |
| --- | --- | --- |
| October 27, 2026 | Confirmed JoyID-approved backup manifest update and independent verification | Amentor-coder's [update](https://pudge.explorer.nervos.org/transaction/0x2707eac62a37e6f7206bfdfbfa240facfbd59e1bd24f8d3eeefe9f7020f47411) is committed and saved as confirmed. Standalone public-RPC verification returns `valid: true`, with one backup proof and one verified anchor; it checks issuer issuance, JoyID claim, approved update lineage, reconstructed manifest root `0x5d06f7f3e77230002559e74b6373bfea9971ff8ec5aa818b83d554a8768bd17f`, and the backup anchor. Result: `/tmp/rivet-cota-manifest-update-verification-331813761.json`. A newer ordinary backup completed while this saved snapshot was being approved, so another sync may be offered for that newer version. Added bounded wallet/server waits, Stop waiting, and status refresh during pending requests; 78 manifest checks and production build pass. Other-account claim, browser unchanged-sync acceptance, and remaining Phase One requirements stay open. |
| October 27, 2026 | Existing-backup manifest sync and general enrollment fixes | Automatically recover missing legacy repository IDs and unambiguous original anchor outpoints with GitHub ownership/creation checks, committed-transaction verification, and stale-write protection. Preserve CID, anchor transaction, commit count, backup date, and prior proofs. `Amentor-coder/testing` reconciled without another backup; update `0x2707eac62a37e6f7206bfdfbfa240facfbd59e1bd24f8d3eeefe9f7020f47411` is prepared with one existing backup proof and a 0.0001411 test CKB fee. Its exact prepared CoTA type check passes (637,941 cycles); JoyID approval/confirmation remains pending. Dashboard separates stored backups from CoTA-synced proofs and exposes Refresh backup for existing public repositories. Removed the two-account trial cap (`COTA_MANIFEST_MAX_ENROLLMENTS=0`); sponsorship retains a configurable funding budget. 173 web checks pass with none skipped, TypeScript and production build pass. |
| October 27, 2026 | Confirmed real JoyID claim and independently verified identity SMT manifest for Amentor-coder | [Claim transaction](https://pudge.explorer.nervos.org/transaction/0x1e4384daa9931097f46945bdd757fc26be3a26889fa24c4d66652f558a254341) is committed. The standalone verifier, using only exported references, the independently configured issuer hash, and public testnet RPC, returns `valid: true` after four transaction reads: trusted issuer attestation, JoyID ownership approval, issuance/claim proofs, and manifest root all pass. Manifest root `0xeec168069dfd192d76e479f9b8f18275a0c28c2a1382a3a053649f0965fd8ca7` commits the developer identity through metadata indexes 2/3 in the user-owned CoTA SMT. This initial snapshot has zero backup records. Backup updates, unchanged-sync/browser acceptance, and the other account's claim remain pending; Milestone 1 stays open. Local artifacts: `/tmp/rivet-cota-manifest-proof-331813761.json` and `/tmp/rivet-cota-manifest-verification-331813761.json`. |
| October 27, 2026 | Confirmed identity-only metadata issuance for both existing JoyID accounts | `jedi-dtechmaker`: [issuance](https://pudge.explorer.nervos.org/transaction/0xf7588d153d0b24a8982fbd3da917edceeac7c15123e59889f7db083a8313a27c), token indexes 0/1, fee 0.00002595 test CKB. `Amentor-coder`: [issuance](https://pudge.explorer.nervos.org/transaction/0x3f3bc30525fbdfc9c1bbbe63eb428e97229dbda1bd32001e56b6bb3872ecdd96), indexes 2/3, fee 0.00002727 test CKB. Each pair targets that account's verified JoyID lock. Both claim plans are saved for real owner approval. Fixed JSONB envelope reserialization and snapshot field-order comparisons found during live claim preparation; 61 targeted checks pass with none skipped and the updated production build passes. No claim or backup-update completion is claimed here. |
| October 27, 2026 | Confirmed dedicated manifest issuer and metadata collection | Issuer registration [transaction](https://pudge.explorer.nervos.org/transaction/0x374917025ea976e09b3a7f85f0b438a4513e330f62e9fb2a668e6acd6111ef1e) reserves 150 test CKB (fee 0.00001726); collection definition [transaction](https://pudge.explorer.nervos.org/transaction/0xd7048f91d67fda7e3ba4b709d7a4c7abfe3acb42faa769009a79d8bc67e4a75a) uses policy `0xf7` (fee 0.0000155), collection `0x8340e0bf4c432def07fef3bae8d46f43569bf4f8`. Both confirmed through RPC; aggregator reports the collection. Additive manifest tables applied. 59 targeted checks pass with none skipped, plus TypeScript and production build. User selected identity-only issuance for both existing accounts, followed by refreshed-backup updates. JoyID claim/update and live independent verification remain pending. |
| October 27, 2026 | Sponsored onboarding architecture and isolated application-tree prototype | `docs/SPONSORED_COTA_ONBOARDING.md` maps the developer discussion to GitHub-first backups and optional JoyID ownership. `cota-hosted-contract.test.cjs` validates initial and subsequent custom-record updates under a generated standard secp owner against the deployed CoTA and lock scripts, preserves another user's entries, and rejects wrong roots/signatures/incomplete prior state. Combined targeted checks: 16 pass, none skipped. This is a Rivet-managed storage candidate, not a live rollout or a fix to the JoyID-owned custom SMT requirement; Milestone 1 remains open. |
| October 27, 2026 | Reproducible deployed-script compatibility diagnostic | `cota:fixture` reconstructs the public testnet identity input and nine dependency cells without app credentials. Five local tests pass with no skips using official CKB debugger v1.1.1: developer/backup extensions under both `0xF0` and `0xF1` pass CoTA and fail JoyID with error 16; signed-witness proofs pass both, and tampering fails. No transaction broadcast. SMT storage remains blocked and Milestone 1 remains open; reproduction steps are in `IDENTITY_ONBOARDING.md`. |
| October 21, 2026 | Dashboard wallet entry point and local ownership/registration implementation | `apps/web/src/components/WalletIdentity.tsx`, identity APIs, 21 passing local checks including temporary PostgreSQL integration, schema comparison, and successful Next.js production build; live testnet acceptance pending |
| October 21, 2026 | Live JoyID connection and verified account linkage; CoTA registry connectivity fix | Verified JoyID address saved for the signed-in account. Prepared registration held 150 test CKB with a 0.00001629 CKB fee; CKB testnet dry run succeeded. No transaction broadcast by the diagnostic. 39 tests and TypeScript pass; on-chain confirmation pending. |
| October 21, 2026 | Confirmed sponsored CoTA registration through the dashboard | [Testnet transaction](https://pudge.explorer.nervos.org/transaction/0x7e96a61e9cf8843712e789f8b80bb33bcdcecaa2d0ea0a37bfb6933d1e06f410), output 1. RPC status committed; cell live with 150 test CKB; ownership lock matches the verified JoyID wallet, CoTA type matches, and initial SMT root is empty. User confirmed the dashboard shows **CoTA identity active**. |
| October 23, 2026 | Reconnect/retry regressions and identity/public-backup SMT sync implementation | 53 passing tests including both PostgreSQL integrations. Deployed CoTA script accepts the exact prepared transaction in offline validation (7,056,978 cycles); later updates pass and a tampered root fails. Prepared `0xe8f1c805de54504f30caa4a07e528820420b93f10b99897d9a6c37680be0ee04` includes developer identity and `Amentor-coder/testing`, with a 0.00014576 test CKB fee. This hash is a prepared transaction, not confirmed delivery evidence. Live approval pending. |
| October 25, 2026 (verification) | Confirmed owner-approved identity and public-backup witness proof | [Committed proof transaction](https://pudge.explorer.nervos.org/transaction/0x2aa15bc36a911eb0f565a6b2820c4df8ebbf7ff2b73d4cc70d9ffa27bc4936d2), output 0 live, locked to the verified JoyID wallet with the original CoTA type. Consumes registration output 1; fee 0.00013744 test CKB; remaining capacity 149.99986256 test CKB. Record commitment `0xdad48c4281d8b21726debfbd0fd9612a709e18101c72806eaf7c6e661048bd72` recomputed from the committed witness. CoTA SMT root remains zero. Includes developer identity and `Amentor-coder/testing`; its backup Merkle root matches [confirmed backup anchor](https://pudge.explorer.nervos.org/transaction/0xbfb44f6f785e777a3c06d122437aa15a3678c0f72cb3d5fd25cd89bb11136046), output 0. Database confirmation was saved October 24; independently rechecked on testnet October 25. No transaction was signed or broadcast during verification. The original SMT storage requirement and full Milestone 1 remain open. |
| October 25, 2026 | Existing-deployment release fixes and testnet privacy enforcement | Safe build with separate additive setup; cross-account proof-update path removed; owner-only public restores; GitHub-verified public backups; persistent worker budgets and queued treasury spending; exact encrypted-bundle restore regression; Auto Sync permission reporting; Next.js 15.5.28/React 19.3.1 and compatible security patches. 92 tests pass with PostgreSQL integrations enabled, one optional external contract-debugger test skipped; TypeScript, production build, frozen install, and workflow YAML checks pass. Production audit has zero critical/high/moderate advisories and one unpatched low upstream wallet dependency advisory. Hosted rollout/acceptance is still pending; see [deployment update guide](./TESTNET_LAUNCH.md). |

Use this file for the funded proposal milestones. `docs/PHASES.md` is the broader product roadmap.
