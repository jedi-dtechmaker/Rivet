# Passport and onboarding acceptance

The Sovereign Passport is a plain Spore V2 digital object on CKB testnet with `application/json` content. It records the immutable GitHub ID, username attested in the verified CoTA snapshot, initial owner lock hash, manifest root, and manifest transaction. This is a Spore DOB with JSON content; it does not claim a DOB/0 DNA decoder, a DOB/1 image renderer, or a Bitcoin RGB++ binding. Ownership is the connected JoyID lock on CKB, as requested. See the [official CCC Spore guide](https://github.com/ckb-devrel/ccc/blob/master/packages/docs/content/docs/guides/spore-protocol.mdx).

The user selected wallet funding for the passport. CoTA sponsorship remains separate. The dashboard shows the passport's locked capacity and transaction fee before JoyID approval. Only ordinary wallet capacity cells fund the mint; the CoTA cell, other typed assets, and cells containing data are excluded. Ensure the JoyID wallet holds enough **available test CKB** for the passport and change. Capacity depends on the serialized content and owner lock; a passport can require substantially more than the 150 CKB CoTA allocation. No treasury key funds this mint.

## Operator setup

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @proof/web exec prisma generate
pnpm --filter @proof/web run release:setup
```

Setup is additive and does not mint or broadcast. `cota:manifest:setup` now includes `prisma/passport.sql`; apply it before enabling the new routes. Configure `PASSPORT_ENABLED=true` alongside the existing manifest issuer/collection configuration, then rebuild/restart the app. Keep environment files private. A production build does not apply database migrations.

One passport row per GitHub identity reserves the mint. Preparation saves the exact unsigned transaction; approval may change only the JoyID lock witness. Server-side full-script preflight runs before accepting an approved candidate. A compare-and-swap saves the first valid candidate before broadcast. Retries reuse its exact transaction and Spore ID, including after a network timeout. A crashed, unsigned build can be reclaimed after five minutes using its build token; an approved or broadcast mint is never automatically replaced. If the wallet spends a reserved funding input outside Rivet, keep the saved plan for operator reconciliation rather than minting a second passport.

Public profiles verify the exported manifest references against the configured trusted issuer and public CKB RPC. They show a confirmed manifest snapshot and, after a confirmed mint, check whether the live Spore is still owned by the linked wallet. A transferred or melted passport is labelled accordingly. The passport's immutable manifest snapshot can differ from later manifest updates. Private profiles expose neither this panel nor the public proof API. Verification does not prove GitHub signatures, newest CoTA state, IPFS availability, or the truth of Git commit timestamps.

## Automated unchanged-sync evidence

```sh
cd apps/web
node --import tsx scripts/check-unchanged-manifest.ts GITHUB_ID /tmp/rivet-unchanged-evidence.json
```

Run only when the confirmed snapshot includes the current public backups. The script refuses accounts with pending work or changes; it never submits or signs a transaction. For a ready account it repeats preparation three times and checks that the operation count, live cell outpoint/data, and capacity are unchanged, then independently verifies the snapshot. It writes evidence exclusively to a new file. This exercises server-side unchanged sync, not browser disconnect/reconnect.

The API now returns a ready, unchanged state before reserving a publication stream or requesting an aggregator proof. The regression test forbids chain/proof calls and has no operation-create method, so creating an operation makes it fail. Wallet reconnect refreshes the dashboard's saved state without requesting a signature.

## Live demo and closure checklist

Record the account, app version, date, explorer links, profile URL, and before/after screenshots or video in the milestone completion log. Do not mark Milestone 1 complete from generated-key contract tests alone.

1. Start with a GitHub account that has no linked wallet. Sign in, back up a public repository, and record the confirmed anchor and CID. Confirm no wallet approval is requested.
2. Connect JoyID, complete the ownership challenge, and activate the sponsored CoTA cell. Record the confirmed owner lock, capacity, and registration transaction.
3. Complete issuance, real JoyID claim, and any manifest update needed to include the latest completed backup. Download the manifest proof and run the independent verifier.
4. Pause Auto Sync and avoid another backup during this comparison. Record the confirmed manifest transaction, operation count, and live cell capacity. Disconnect, reload, reconnect the **same** JoyID wallet, and refresh manifest status. Confirm no new signature, transaction, or fee. Repeat unchanged preparation using the script above and save its evidence. If a backup changed, sync it with explicit owner approval before repeating.
5. For the older signed-witness alternative, compare against its saved confirmed snapshot only if the records are still unchanged. If later backups differ, preparing that old protocol would create a legitimate new transaction; do not do so merely to claim a no-fee check. Preserve the old evidence and record this limitation separately.
6. Prepare the passport, review locked capacity and fee, and approve with the real JoyID wallet. Record the confirmed mint hash, Spore ID, live owner lock, and fee. Reconnect and retry/refresh: the same mint must be returned with no second mint or fee.
7. Open the public profile signed out. Confirm the verified manifest root and backup count, passport Spore ID, linked-wallet ownership, and both transaction links. Set the profile private and confirm the public proof endpoint returns no identity. Restore visibility only if the owner chooses.
8. Record all evidence and check the outstanding Milestone 1 acceptance items. Mark it complete only after the live demonstration and required reconnect checks pass.

Live follow-up: the passport table is applied to the actual database, `PASSPORT_ENABLED=true` is set in the ignored runtime configuration, and the running app at `http://localhost:3000` includes the mint flow. The original pooler connection timed out; the optional `pg` adapter with `DATABASE_IP_FAMILY=4` and the direct endpoint of the same database restores application access while preserving TLS hostname checks. The real public identity API returns HTTP 200 and independently verifies Amentor-coder's confirmed manifest.

The owner explicitly authorized a test-treasury top-up after the JoyID wallet was found to have no ordinary capacity cells. [Funding transaction](https://pudge.explorer.nervos.org/transaction/0x62a33ccb19c140b04910c232a42226749b1a60d029b1abaa454b88cd99424ca3) is confirmed and transfers 830 test CKB to the verified JoyID wallet. The calculated passport capacity is 759 CKB, with the remainder covering change and fees. The wallet still approves and funds the passport transaction. The real manifest has a newer completed backup to sync before unchanged acceptance. Real JoyID update/mint approvals and browser reconnect evidence remain pending; treasury funding is not passport mint evidence.

## Reproducible local verification

Generate public script fixtures without application credentials or a broadcast:

```sh
pnpm --filter @proof/web run cota:fixture --include-secp --include-spore --output /tmp/rivet-passport-fixture.json
cd apps/web
RIVET_TEST_DATABASE_URL=DISPOSABLE_POSTGRES_URL \
RIVET_CKB_DEBUGGER=/path/to/ckb-debugger \
RIVET_CKB_FIXTURE=/tmp/rivet-passport-fixture.json \
RIVET_PASSPORT_FIXTURE=/tmp/rivet-passport-fixture.json \
node --import tsx --test tests/*.test.cjs
```

Use a disposable database with the Prisma schema applied. This session passed 190 web checks with none skipped, plus two CLI recovery checks. The tests include the real Spore/JoyID contract binaries with a generated passkey, owner/content tampering rejection, concurrent PostgreSQL signature acceptance, additive migration replay, private-profile suppression and CLI recovery-key isolation. TypeScript and the production build pass. Generated-passkey tests simulate the lock; they do not perform a real JoyID browser approval.
