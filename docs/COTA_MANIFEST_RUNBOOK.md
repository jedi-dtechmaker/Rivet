# JoyID CoTA manifest acceptance

The manifest lifecycle uses a dedicated testnet issuer and the developer's existing JoyID-owned CoTA cell. Issuance creates two metadata NFTs containing the complete 32-byte identity-only manifest root. Claim and subsequent atomic updates require the owner's JoyID approval. Public backup records enter the manifest through an update after initial claim.

## Issuer setup

Run from `apps/web`:

```sh
npm run cota:manifest:setup
npm run cota:issuer -- create
npm run cota:issuer -- prepare
```

`create` writes `.env.cota-manifest-issuer.local` with owner-only permissions and refuses to overwrite it. Keep the issuer key separate from the sponsor key. `prepare` saves a transaction without broadcasting. Registration reserves 150 test CKB plus a fee from the sponsor. The existing sponsorship quota includes issuer registrations; allow only the additional registration intended for setup.

Review the printed operation ID and fee, then submit that operation:

```sh
npm run cota:issuer -- submit --id OPERATION_ID
npm run cota:issuer -- status --id OPERATION_ID
```

After registration confirms, run `prepare` again to define the collection. Submit the new definition operation and wait for confirmation. Pin the confirmed collection ID as `COTA_MANIFEST_COLLECTION_ID`. Configure `COTA_MANIFEST_ISSUER_PRIVATE_KEY` in the app's server environment; Next.js does not automatically load `.env.cota-manifest-issuer.local`. Never expose either private key through a `NEXT_PUBLIC_` setting.

## Browser acceptance

Enable `COTA_MANIFEST_ENABLED=true` for the local acceptance session after issuer setup, and restart the app. Keep the feature disabled in production until live acceptance passes.

1. Sign in with GitHub, open `/dashboard#identity`, and reconnect the verified CKB testnet JoyID wallet. Reuse the existing identity cell.
2. In **Your CoTA manifest**, consent to the two public metadata records. Choose **Create CoTA metadata records**, review the prepared issuance, then **Continue saved transaction**. Rivet signs this issuer transaction; it does not require the user's passkey.
3. Wait for issuance confirmation and choose **Prepare JoyID claim**. Review the fee and choose **Review and approve in JoyID**. The user completes the passkey prompt. Wait for claim confirmation.
4. Download the manifest proof and verify it using the independently obtained issuer lock hash:

   ```sh
   npm run cota:manifest:verify -- --proof /path/to/proof.json --issuer-lock-hash TRUSTED_ISSUER_LOCK_HASH
   ```

5. Choose **Sync existing backup proofs**. Older backups with missing metadata are reconciled automatically using their saved confirmed anchor and current public GitHub repository identity. This does not upload another bundle or create another backup anchor. Review and approve the update in JoyID, wait for confirmation, then download and independently verify the new proof. If an old record cannot be reconciled, the error identifies the repository; **Refresh backup** is available on its existing dashboard card.
6. Disconnect and reconnect the same wallet. An unchanged manifest should remain synchronized without a new transaction or fee. Check cancellation and retry: unsigned plans remain saved, rejected signatures may be corrected, and uncertain broadcasts retry the exact saved signed bytes.

Record the issuer registration, collection definition, issuance, claim, update, and independent verification evidence before closing SMT acceptance. Local builder tests and generated passkey contract checks do not establish live browser acceptance.

## Local verification

October 27 local acceptance: dedicated issuer registration, collection definition, and both identity-only issuances are confirmed. The collection is `0x8340e0bf4c432def07fef3bae8d46f43569bf4f8`; token indexes 0/1 belong to `jedi-dtechmaker` and 2/3 to `Amentor-coder`. One additional issuer registration was explicitly authorized for setup. The initial two-enrollment trial cap has since been removed: `COTA_MANIFEST_MAX_ENROLLMENTS=0` permits every eligible account and is the default. Positive values remain optional operator trial budgets. Local user-identity sponsorship has a ten-registration funding budget; adjust `COTA_SPONSOR_MAX_REGISTRATIONS` with available testnet capacity. These funding controls do not restrict GitHub signup or ordinary backups to specific accounts. Transaction references are recorded in [Phase One milestones](./PHASE_ONE_MILESTONES.md).

Claim preparation reuses the exact confirmed issuance witness. PostgreSQL JSONB may reorder nested object fields, so stored snapshots and enrollment manifests are compared by value; reserializing JSONB is not a valid way to recover signed canonical bytes.

Both exact prepared claim transactions also pass the deployed CoTA type script in CKB debugger v1.1.1 with their actual issuance block headers: `jedi-dtechmaker` uses 15,772,334 cycles and `Amentor-coder` uses 15,789,513 cycles. Local public-data fixtures are `/tmp/rivet-claim-preflight-317234232.json` and `/tmp/rivet-claim-preflight-331813761.json`; run `ckb-debugger --tx-file FIXTURE --script input.0.type`. These are unsigned claims, so the result establishes the CoTA proof path only. Real JoyID approval, full signed-transaction preflight, broadcast, and confirmation remain required.

Later October 27 acceptance: Amentor-coder completed real JoyID approval. Claim `0x1e4384daa9931097f46945bdd757fc26be3a26889fa24c4d66652f558a254341` is confirmed. Exported proof `/tmp/rivet-cota-manifest-proof-331813761.json` passes the standalone verifier against trusted issuer lock hash `0xf2834302ab71b9094c16c1507e9ce2289dade32b444491d557da1c439c8f8579`; the result is saved in `/tmp/rivet-cota-manifest-verification-331813761.json`. This identity-only snapshot contains zero backups. The existing `Amentor-coder/testing` backup has since been reconciled without another backup, and update `0x2707eac62a37e6f7206bfdfbfa240facfbd59e1bd24f8d3eeefe9f7020f47411` is prepared with one backup proof and a 0.0001411 test CKB fee. Owner approval/confirmation of that update and the other account's real claim remain pending.

Metadata recovery preserves the original CID, anchor transaction, commit count, backup timestamp, and earlier signed proofs. It associates a missing repository ID only when GitHub confirms the same public path under the signed-in user's immutable owner ID and a creation date predating Rivet's saved repository record. It recovers a missing anchor output index only from an unambiguous untyped 32-byte output in the original committed transaction. Recreated/foreign repositories, ambiguous anchors, and concurrent record changes are rejected. This association is a current Rivet issuer attestation, not a historical signature from GitHub. Network reads occur outside database transactions, and metadata writes compare the saved backup revision before changing anything.

Approval recovery: the dashboard distinguishes waiting for JoyID from waiting for the server. A wallet wait ends after 90 seconds or **Stop waiting**; close the old JoyID window before retrying. Late wallet responses cannot continue a cancelled submission. Server requests have a 60-second deadline and retain the approved bytes for exact retries. A request timeout does not imply that broadcast failed: use **Refresh manifest status**, which remains available during the wait, before retrying. These controls bound the app's wait; they do not confirm that a real passkey interaction or transaction has succeeded.

Subsequent October 27 verification: Amentor-coder's saved update `0x2707eac62a37e6f7206bfdfbfa240facfbd59e1bd24f8d3eeefe9f7020f47411` is confirmed and its exported-reference proof passes the standalone verifier with one backup and one verified anchor. A transient remote database transaction timeout occurred during confirmation reconciliation; retrying the status check recorded confirmation without another signature or broadcast. An ordinary backup completed during approval, so the confirmed snapshot can validly differ from the latest backup record. Do not describe that later change as a failed approval or resubmit the confirmed transaction.

```sh
node_modules/.bin/tsc --noEmit
RIVET_TEST_DATABASE_URL=TEMPORARY_POSTGRES_URL \
RIVET_CKB_DEBUGGER=/path/to/ckb-debugger \
RIVET_CKB_FIXTURE=/path/to/public-fixture.json \
node --import tsx --test tests/cota-manifest*.test.cjs
```

Use a disposable PostgreSQL database with the application schema. The public fixture must include secp dependencies (`cota:fixture --include-secp`). The suite checks the production define/mint builders against deployed scripts, JoyID metadata update compatibility, proof validation, reservations, stale workers, signature correction, and exact-byte retries. The claim builder tests use constructed transaction-in-block proofs; the live claim remains a separate acceptance step.
