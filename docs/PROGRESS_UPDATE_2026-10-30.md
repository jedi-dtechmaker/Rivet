# Rivet — Milestone 1 Delivery Report

**CKB Testnet**

Implementation and project acceptance testing for Rivet’s first grant milestone are complete and ready for community review. Milestone 1 delivers GitHub-first onboarding, optional JoyID wallet ownership verification, sponsored CoTA identity activation, identity and backup-proof commitments in a user-owned CoTA tree, and Sovereign Passport minting on CKB Testnet.

The hosted acceptance run covered GitHub sign-in and wallet-free backup through identity activation, manifest claim and sync, passport minting, and public-profile display. Reconnect, unchanged sync, duplicate-mint prevention, independent proof verification, and profile-privacy checks have also been completed. The implementation and linked testnet evidence are submitted here for community and milestone review.

- Repository: [jedi-dtechmaker/Rivet](https://github.com/jedi-dtechmaker/Rivet)
- Hosted application: [rivet-web-ten.vercel.app](https://rivet-web-ten.vercel.app/)
- Dashboard: [rivet-web-ten.vercel.app/dashboard](https://rivet-web-ten.vercel.app/dashboard)
- Funded proposal and discussion: [Rivet: Decentralized GitHub Backup, Timestamping and Restore on CKB](https://talk.nervos.org/t/dis-rivet-decentralized-github-backup-timestamping-and-restore-on-ckb/10739)
- Milestone checklist: [Phase One milestones](https://github.com/jedi-dtechmaker/Rivet/blob/main/docs/PHASE_ONE_MILESTONES.md)
- Latest implementation release in this report: [commit ff5b040](https://github.com/jedi-dtechmaker/Rivet/commit/ff5b040)

The three Milestone 1 deliverables map to the implementation as follows:

| Deliverable | Delivered behavior | Review evidence |
| --- | --- | --- |
| CoTA onboarding | Rivet-sponsored activation creates a CoTA cell under the developer’s verified JoyID lock; the developer can claim and update identity and backup commitments. | Registration, issuer, claim, and update transactions linked below. |
| Optional JoyID connection | GitHub backups work without a wallet; connecting JoyID starts account-bound ownership verification before on-chain activation. | Hosted dashboard, wallet-proof implementation, and completed hosted onboarding checks. |
| Sovereign Passport | A verified manifest snapshot is minted as a wallet-owned Spore digital object, with saved mint plans, exact retries, and public-profile integration. | Passport mint, Spore ID, implementation, and completed ownership/privacy checks linked below. |

Rivet connects repository backup evidence to a developer-controlled on-chain identity. GitHub remains the starting point: a developer signs in and can back up public repositories without first creating or connecting a wallet. The backup flow mirrors repository history, produces a Git bundle, pins it to IPFS, and anchors its commit-set commitment on CKB. Developers who want an on-chain identity can then connect JoyID from the dashboard.

Wallet linking requires a server-issued ownership challenge bound to the account, wallet, origin, and expiry. JoyID’s passkey signature is verified before the wallet is linked to the GitHub identity. An address submitted by itself is insufficient. The connected developer then activates a sponsored CoTA identity, with the resulting cell locked to their verified JoyID wallet.

The initial confirmed registration provided 150 test CKB of capacity through Rivet sponsorship. Users do not need to acquire that capacity themselves to activate their identity. Registration and transaction state are persisted so retries can recover the existing operation.

- Sponsored registration: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0x7e96a61e9cf8843712e789f8b80bb33bcdcecaa2d0ea0a37bfb6933d1e06f410)
- Ownership and onboarding implementation: [WalletIdentity](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/components/WalletIdentity.tsx)
- Server-side passkey and wallet verification: [wallet-proof.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/lib/wallet-proof.ts)

The CoTA manifest lifecycle now supports issuance, owner-approved claim, and subsequent backup updates. A dedicated Rivet issuer creates the metadata records, and the developer claims them into their JoyID-owned CoTA tree. Later updates add completed public backup proofs with explicit JoyID approval. The records commit the full 32-byte manifest root; the exported manifest provides the identity and backup records needed to reconstruct and check that commitment.

The manifest format is versioned as `rivet-cota-manifest-v1`. Its binding includes the CKB network, immutable GitHub account ID, owner and issuer lock hashes, collection ID, and two distinct token indexes. Developer records bind the GitHub identity to the wallet lock. Backup records contain the immutable repository ID, repository name, IPFS CID, commit-set Merkle root, anchor outpoint, and commit count. Record keys use immutable repository IDs so a repository name alone cannot substitute a different repository.

Two CoTA metadata records carry the complete root: the first characteristic stores 20 bytes, and the second stores the remaining 12 bytes with canonical padding. Verification reconstructs the full root and checks the manifest records against it. The Git bundle itself remains in IPFS.

Independent manifest verification checks the configured issuer binding, JoyID ownership approval, issuance and claim references, the reconstructed manifest commitment, and the referenced backup anchor through public CKB Testnet RPC. The verified backup snapshot contains one public backup proof and one verified backup anchor.

- Issuer registration: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0x374917025ea976e09b3a7f85f0b438a4513e330f62e9fb2a668e6acd6111ef1e)
- Metadata collection definition: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0xd7048f91d67fda7e3ba4b709d7a4c7abfe3acb42faa769009a79d8bc67e4a75a)
- JoyID-approved claim: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0x1e4384daa9931097f46945bdd757fc26be3a26889fa24c4d66652f558a254341)
- Initial independently verified backup update: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0x2707eac62a37e6f7206bfdfbfa240facfbd59e1bd24f8d3eeefe9f7020f47411)
- Latest confirmed manifest update: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0xb7f6c86d899794fd9534338ae77a280946e1d0f8dffef0d53ba099d3b60d4feb)
- Verification procedure: [CoTA manifest runbook](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/docs/COTA_MANIFEST_RUNBOOK.md)
- Standalone verifier: [verify-cota-manifest.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/scripts/verify-cota-manifest.ts)

The public testnet identifiers used by this release are:

- Manifest collection ID: `0x8340e0bf4c432def07fef3bae8d46f43569bf4f8`.
- Trusted issuer lock hash: `0xf2834302ab71b9094c16c1507e9ce2289dade32b444491d557da1c439c8f8579`.
- Exported proof format: `rivet-cota-manifest-proof-v1`.
- Record encoding and commitment construction: [cota-manifest.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/lib/cota-manifest.ts).
- Chain-based proof checks: [cota-manifest-verify.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/lib/cota-manifest-verify.ts).

Reviewers can download the manifest proof from the dashboard, independently compare the issuer lock hash against the public deployment evidence, and run the standalone verifier from the repository root:

```sh
pnpm --filter @rivet/web exec tsx scripts/verify-cota-manifest.ts \
  --proof /absolute/path/rivet-cota-manifest-proof.json \
  --issuer-lock-hash 0xf2834302ab71b9094c16c1507e9ce2289dade32b444491d557da1c439c8f8579
```

The verifier reads transaction references from the proof package and retrieves committed transaction data from the selected public RPC. It reconstructs the issuance, claim, and update lineage and checks each backup root against its referenced anchor output. It requires neither Rivet database credentials nor an issuer private key. A proof cannot select its own trusted issuer.

The dashboard shows one stored public backup, one synced proof, and no newer completed backup awaiting sync. Independent verification of the latest manifest and current passport ownership was included in the completed project acceptance checks.

Existing backups can be reconciled into the manifest without uploading another bundle or producing another backup anchor. Preparation also detects an unchanged confirmed snapshot before reserving another publication operation. Approved transaction bytes are saved for exact retries after an uncertain submission. Live acceptance confirmed that disconnecting, reloading, and reconnecting the same wallet preserves the synchronized state without another transaction or fee when the records are unchanged.

The Sovereign Passport is implemented as a Spore V2 digital object owned through the developer’s verified JoyID wallet. Its immutable JSON content records the GitHub identity, initial owner lock hash, manifest root, and manifest transaction reference. The passport preserves the verified snapshot selected at mint time; a later backup update can advance the current manifest independently.

Passport content uses `rivet-sovereign-passport-v1` with the content type `application/json`. Mint validation checks the Spore type, identifier, owner lock, and exact saved content. Approval may replace the JoyID lock signature but cannot alter the prepared outputs, fees, dependencies, or other saved witnesses. Public-profile verification checks both the confirmed mint and the live Spore cell, so transferred or no-longer-live passports can be distinguished from passports still held by the linked wallet.

The confirmed real-wallet mint is recorded here:

- Passport mint: [CKB Testnet transaction](https://pudge.explorer.nervos.org/transaction/0x541a6e1ff749dd56cf38fa5d6c7fdd69686868110e5c9ab8120cd3d4ca7eb3dc)
- Spore ID: `0x3354b38df9a9a245cc01aabf57be83529bc97d826844fb72f156ce02458d0aad`
- Locked capacity: 759 test CKB.
- Network fee: 0.00013595 test CKB.
- Mint implementation: [passport-service.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/lib/passport-service.ts)
- Passport content and approval validation: [passport.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/lib/passport.ts)
- Public manifest and current ownership verification: [public-identity.ts](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/src/lib/public-identity.ts)

The wallet funds the passport from ordinary capacity cells and approves the transaction through JoyID. The CoTA identity cell and other typed assets are excluded from funding selection. For the test demonstration, the wallet received an authorized treasury top-up before minting. The capacity locked in the passport is separate from the transaction fee.

Mint preparation reserves one saved plan per GitHub identity. Submission validates the approved transaction, persists the first valid signed candidate, and reuses that exact transaction during retries. Live refresh and retry checks returned the same mint without a duplicate mint or additional fee.

Public profiles now have a developer-passport panel that verifies exported manifest references and checks whether the live Spore remains owned by the linked wallet. Private profiles suppress public identity proofs. The dashboard and profile also present a visual passport card, green activation and sync indicators, compact backup statistics, expandable transaction details, and refresh controls with loading, success, and failure feedback.

The current passport’s on-chain content is JSON. The graphic card is an application presentation of that object; its artwork is not embedded in the minted Spore. The implementation does not include a Bitcoin RGB++ binding or a DOB image-renderer protocol.

Several implementation choices clarify the proposal’s delivery model. Wallet onboarding starts when a developer chooses **Connect Wallet**, rather than being required for the first backup. The CoTA manifest uses the supported metadata lifecycle after an earlier custom extension proved incompatible with the deployed JoyID lock. Historical signed-witness proofs remain available, but they are not counted as satisfying the CoTA SMT storage requirement.

Registration is designed for general use. There is no hardcoded user allowlist, and manifest enrollment has no account cap by default. Identity sponsorship has a separate configurable capacity budget. The shared issuer and collection are Rivet infrastructure used to issue records for eligible users; each developer’s identity cell and passport are associated with their own verified wallet.

Automated validation for implementation commit `ff5b040` recorded:

- 139 web checks passed, with zero failures and 13 environment-dependent checks skipped.
- TypeScript checking passed.
- The CLI test file passed.
- Git whitespace checks passed.

Earlier engineering sessions recorded additional disposable-PostgreSQL and deployed-script validation, including wallet-proof rejection, proof tampering, concurrent approval handling, additive schema upgrades, and saved transaction retries. Those results are documented in the repository’s acceptance material. They were not all rerun in the latest pre-push check, and no external security audit is claimed.

The published tests make the main failure cases reviewable:

- [Wallet ownership tests](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/tests/wallet-proof.test.cjs) reject mismatched challenges, malformed proofs, credentials belonging to another wallet, and unsupported wallet types.
- [Manifest verification tests](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/tests/cota-manifest-verify.test.cjs) reject substituted issuers or GitHub identities, unconfirmed transactions, incorrect RPC transaction hashes, missing approval witnesses, inconsistent roots, incorrect backup anchors, and updates disconnected from the declared claim.
- [Passport tests](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/tests/passport.test.cjs) cover content and owner validation, immutable approval boundaries, saved-mint retries, and ordinary-wallet-cell funding selection.
- [Passport database tests](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/apps/web/tests/passport-database.test.cjs) cover concurrent signature acceptance and repeat additive migrations preserving saved mint bytes. These require disposable PostgreSQL and belong to the environment-dependent integration checks.

- Test sources: [web tests](https://github.com/jedi-dtechmaker/Rivet/tree/ff5b040/apps/web/tests)
- Release-check workflow: [checks.yml](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/.github/workflows/checks.yml)
- Acceptance procedure: [Passport and onboarding acceptance](https://github.com/jedi-dtechmaker/Rivet/blob/ff5b040/docs/PASSPORT_AND_ONBOARDING_ACCEPTANCE.md)

Hosted configuration and proof availability have been resolved and checked. The completed Milestone 1 acceptance covers:

- The hosted flow from GitHub sign-in and wallet-free backup through wallet verification, sponsored activation, claim, backup sync, passport mint, and public-profile display.
- Disconnect, reload, and reconnect to the same wallet, followed by unchanged sync without another transaction or fee.
- Passport refresh and retry returning the same mint without a duplicate transaction or fee.
- Independent verification of the latest manifest and current passport ownership, plus public/private profile checks.
- Consolidation and checking of explorer references and screenshots or video for reviewer inspection.

The next milestone covers CLI restore tooling and hardening. Initial source commands for backup, status, legacy-proof verification, and exact restore are present, with local recovery checks after removing the original repository. Published cross-platform releases, attribution restore with signed mapping proofs, stronger anchor payloads binding refs and bundle bytes, and live restore acceptance remain ahead.

Rivet remains on CKB Testnet, with private repository backups disabled in this flow. Its anchors establish repository-state commitments at blockchain checkpoints; they do not certify developer-supplied Git commit dates or guarantee current IPFS availability.

The trust boundaries are explicit: Rivet’s issuer attests the GitHub identity association, the selected CKB RPC supplies committed status and chain data, and the verifier checks the referenced snapshot and its commitments. It is not an independent block-header verifier, and snapshot verification does not establish that no newer CoTA update exists. Current file availability is separate from proof validity.

Milestone 1 is ready for community review. Useful independent checks include:

- Sign in with GitHub, back up a public repository without connecting a wallet, and inspect the resulting CKB anchor and IPFS reference.
- Connect a CKB Testnet JoyID wallet, verify ownership, and follow the sponsored identity, manifest claim, and backup-sync flow.
- Download the manifest proof and run the standalone verification command above.
- Review the displayed passport capacity and fee before minting; reconnect and refresh to confirm the same saved mint is returned.
- Inspect the public profile and its transaction links, then check that private-profile visibility suppresses public identity proofs.

Please share test results, unexpected behavior, or integration questions in the proposal thread or through [GitHub Issues](https://github.com/jedi-dtechmaker/Rivet/issues). Review and sign-off on the Milestone 1 delivery are requested.
