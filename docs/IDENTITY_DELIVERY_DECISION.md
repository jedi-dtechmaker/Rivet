# Identity delivery recommendation

Status: engineering recommendation and bounded protocol prototype, not a completed integration or an amendment to the funded proposal.

## Decision and constraints

Keep GitHub-first public backups, explicit optional JoyID connection, Rivet-funded initial capacity, and one user-owned CoTA cell. The recommended next implementation target is a standard CoTA metadata representation of a single canonical Rivet manifest root inside that user's CoTA SMT. Retire the incompatible `ff00/rivet1` extension from new user-owned submissions; preserve its diagnostic evidence and earlier signed attempts.

This choice assumes CoTA, JoyID, and user-owned SMT storage remain requirements. It changes the application's record encoding while preserving the intended ownership and single-root storage arrangement. It still needs complete mint/claim/update/verification acceptance before being described as delivered.

Do not add a production Rivet-managed shared application tree for this release. That experiment demonstrates CoTA contract compatibility under another owner; it changes the trust model and introduces another publication service. Do not add a separate native application-root cell at the same time. The existing backup anchors continue to serve wallet-free users.

The [funded proposal](https://talk.nervos.org/t/dis-rivet-decentralized-github-backup-timestamping-and-restore-on-ckb/10739) describes developer identity and backup proof represented through one user CoTA SMT root; it does not prescribe `rivet1` key encoding. The existing agreed adjustment defers personal wallet/CoTA onboarding until the user chooses **Connect Wallet**. Retain that adjustment. GitHub OAuth is not a substitute for the user's JoyID passkey interaction.

## User flow

1. Sign in with GitHub and run public backups. Keep the existing sponsored repository anchors and IPFS bundle flow. No wallet, metadata issuance, or CoTA registration is required to start.
2. Choose **Connect Wallet**, connect/create JoyID, and complete the existing ownership challenge. Rivet funds registration of the user's CoTA cell when required; reuse an existing matching cell.
3. Rivet issues the designated metadata records through standard CoTA operations. The owner claims them into the existing user-owned CoTA tree. Retain the exact collection/token identifiers and verify their issuer and configuration.
   For the initial local acceptance, the user selected identity-only issuance for both existing accounts. Backup proofs are added in a subsequent owner-approved update after legacy records have been refreshed with immutable GitHub repository IDs and confirmed anchor outpoints. The UI states this initial scope and reports zero included backups until an update confirms.
4. The owner approves atomic updates of both manifest parts using the standard CoTA NFT update operation. Keep unrelated wallet authorization, recovery, asset, and claim entries intact. All new publication must pass the actual deployed type and lock scripts.
5. Export the full manifest and proof package. Later mint the planned Spore Sovereign Passport to the connected wallet and reference a confirmed manifest snapshot. A passport snapshot is not an automatically mutable copy of the latest manifest.

These metadata records use CoTA NFT semantics. Their issuance and claim are real protocol steps, with fees and signing interactions that must be measured. The Spore passport remains a separate asset and deliverable.

Ordinary backups continue after wallet connection without waiting for manifest approval. A wallet-owned manifest is an explicitly approved snapshot; show its confirmed version/time separately from the latest backup. Batch pending public-backup records into the next user-approved manifest sync. Do not promise automatic wallet-owned updates without defining and validating a separate delegation model.

## Manifest representation and verification

Use one versioned manifest per developer, binding the network, immutable GitHub account ID, verified owner lock hash, and public backup records. A backup record identifies the immutable GitHub repository ID when available, display name, CID, confirmed anchor outpoint and Merkle root. Usernames and repository paths are display attributes, not identity keys. Introduce a new explicitly versioned encoding if changing the existing record-key scheme; earlier proof commitments must remain verifiable under their original version.

Build a canonical record SMT and retain its complete 32-byte root. The existing CoTA characteristic field has 20 bytes, so the proposed representation uses exactly two designated mutable metadata records: the first contains root bytes 0–19; the second contains root bytes 20–31 followed by eight zero padding bytes. Do not truncate the root. Update both records in one owner-approved transaction. Select and verify configuration that allows owner metadata updates and prevents unintended transfer/destruction; passing a synthetic update is not proof of the complete issuance policy.

Retain a public, issuer-authenticated binding between the designated token pair, immutable GitHub ID and verified owner lock. This is Rivet's attestation of the GitHub-to-wallet link, not a signature from GitHub. A wallet's approval of arbitrary identity fields alone must not be presented as independent proof that GitHub authenticated those fields.

The app manifest root and the cell's CoTA root are distinct. The CoTA root commits the two metadata leaves alongside the wallet's other records. An independent verifier must check:

1. Network, confirmed transaction and CoTA owner/type identity.
2. The designated issuer, collection/token identifiers, configuration and both metadata leaves under the same confirmed CoTA root.
3. Root reconstruction with exact chunk sizes, ordering and padding.
4. Identity/backup record inclusion under the reconstructed manifest root and the expected wallet/GitHub bindings.
5. Each referenced backup anchor and bundle checks required by the backup protocol.

Export the necessary records, inclusion proofs, relevant transactions/witnesses and protocol version. The historical export must remain usable without Rivet's database. A wallet signature proves approval of a commitment; it does not establish Git authorship, truthful commit dates, or continued IPFS availability.

Use a maintained CoTA proof/state implementation to preserve the user's existing tree. The current local `buildSmt` reconstruction has a 128-leaf application limit and must not be used to reconstruct a partially known JoyID tree or promoted into an unlimited shared publisher.

## Reliable publication and signature recovery

Replace the global database lock spanning external RPC with a reservation for the actual publication stream: network plus CoTA script identity. Reserve the source head and snapshot relevant records in a short transaction. Fetch RPC data and construct the proof outside that transaction. Commit the immutable unsigned plan only if a compare-and-swap confirms that the stream revision, reservation and relevant wallet/record revisions still match. Allow at most one pending plan per actual cell across protocols. Expired build leases may restart unpublished work; they cannot authorize replacing a potentially broadcast transaction.

Keep signed candidates as separate immutable attempts, including a digest of the full serialized transaction/witnesses, preflight outcome and broadcast state. A CKB raw transaction hash does not include witnesses, so the hash alone does not identify a signature attempt. Preflight a candidate before it becomes the accepted broadcast attempt. Archive a definitively invalid signature before any send and permit the owner to sign the same unsigned plan again. Classify unsupported operations separately: another signature cannot repair them.

Persist the accepted signed bytes and the start of broadcasting before the send. After a send timeout or crash, reconcile and retry those exact bytes. A missing transaction response with a still-live input does not prove nothing was sent. Never delete history and grant another subsidy as generic retry recovery. If another transaction spends the input, identify the actual committed successor before rebuilding. Save and export the actual validated committed transaction, including its witnesses.

Suggested publication lifecycle:

```text
building -> awaiting_signature -> validating -> signed_ready -> broadcasting
                                                           -> submitted/unknown
                                                           -> confirmed
```

Store rejected attempts separately with their diagnostics. Keep current confirmed proofs and the blocked legacy extension attempt available; do not silently rewrite them into the new protocol.

## Delivery gates and order

First validate the complete supported-format lifecycle for one testnet account: issue the pair, claim it into an existing JoyID-owned CoTA tree, atomically update both parts, preserve preexisting records, and independently verify the full proof package. Repeat an unchanged sync without another signature, transaction or fee. Test cancellation, bad signatures, bad roots, different-wallet rejection and the actual connected wallet's approval. Offline tests with generated keys and assumed held assets are evidence only for the transitions they exercise.

The new `apps/web/tests/cota-manifest-contract.test.cjs` exercises the two-part aggregate manifest update with a generated primary passkey and a simulated already-held token pair. It separately decodes the signed update and recomputes the record root; that test-local helper is not a production external verifier. A coherently signed metadata change can satisfy both generic contracts while failing the application manifest binding, so the independent application-level checks are mandatory. Issuance, claiming and the real wallet approval remain unverified.

October 27 local verification: the manifest contract test plus existing identity contract, SMT and sponsored-registration tests passed 16 checks with none skipped. Reproduce with an official CKB debugger and the public fixture described in `SPONSORED_COTA_ONBOARDING.md`:

```sh
RIVET_CKB_DEBUGGER=/path/to/ckb-debugger \
RIVET_CKB_FIXTURE=/tmp/rivet-sponsored-cota-fixture.json \
pnpm --filter @proof/web exec tsx --test tests/cota-manifest-contract.test.cjs tests/identity-proof-contract.test.cjs tests/cota-smt.test.cjs tests/cota.test.cjs
```

In the same implementation, test independent-cell concurrency, one reservation per cell across protocols, stale worker fencing, corrected signatures before broadcast, exact-byte retries after send uncertainty, and proof export from actual committed witnesses. Do not hold the global database lock while waiting for RPC.

Then integrate the supported protocol into preparation/submission and the dashboard, finish browser reconnect acceptance, and implement the Spore passport/profile flow. Continue the CLI and independent restore-verification commitments without adding more identity storage models.

Do not enable a new protocol or mark the SMT checklist complete until its live lifecycle and independent verification pass. If standard issuance/claim/update, the required nontransferable configuration, or independent verification fails, stop this candidate and use the reproducer to obtain upstream support for the required CoTA operation. Do not silently switch to hosted ownership or claim the signed-witness alternative satisfies SMT storage.
