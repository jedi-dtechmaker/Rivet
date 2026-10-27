# Testnet identity onboarding

GitHub remains the registration and sign-in method. Backups do not create a personal CoTA cell or prompt for a wallet. The dashboard's optional **Connect Wallet** action opens the existing CCC connector, including JoyID's CKB testnet/passkey flow.

## Implemented flow

The installed CCC connector includes a [startup patch](../patches/README.md) so wallet discovery waits for its CKB client during browser hydration. Install dependencies with pnpm to retain this fix.

1. Sign in with GitHub and open `/dashboard#identity`.
2. Choose **Connect Wallet** and select the CKB testnet JoyID signer. Create or select an account in JoyID.
   If another wallet is already connected, use **Choose JoyID wallet** in the identity panel, then select JoyID on CKB testnet. **Activate identity** remains disabled until a supported wallet is connected.
3. Choose **Activate identity**. Rivet issues a five-minute, single-use challenge bound to the GitHub account, wallet, website, and testnet. JoyID asks the user to sign it.
4. The server verifies the signature and checks that the public key belongs to that address through JoyID's testnet credential API. Previously stored addresses are not trusted until verified. Session keys are not accepted for linking.
5. Rivet builds a CoTA registry transaction using a dedicated sponsor wallet. The CoTA output is locked to the user's JoyID script; Rivet pays its capacity and the transaction fee. The user's funds and private keys are not used.
6. The signed transaction is saved before broadcasting. Retries resend the same transaction. The dashboard tracks submission separately from confirmation and links to the testnet explorer.

Disconnecting the wallet ends the browser connection and preserves the verified identity and registration. Reconnect the same wallet to continue. Replacing a wallet after registration is deliberately blocked until a migration/recovery flow is implemented.

For the standard metadata issuance, JoyID claim, and atomic manifest update candidate, follow the [CoTA manifest acceptance runbook](./COTA_MANIFEST_RUNBOOK.md). Its issuer setup and live acceptance are tracked separately from the earlier signed-witness proof.

## Configuration and database

### Step-by-step sponsor setup

CoTA does not issue a separate private key. Rivet uses a dedicated CKB testnet account to sponsor registration. The user connects a separate JoyID wallet and keeps control of their identity. You do not export the user's JoyID/passkey private key.

Run these commands from the repository root:

1. Create the sponsor locally:

   ```sh
   pnpm --filter @proof/web run cota:sponsor create
   ```

   The helper generates a secp256k1 key on your computer, saves it to `apps/web/.env.cota-sponsor.local` with owner-only permissions, and prints only the public `ckt1...` address. The file is ignored by Git. It refuses to overwrite an existing key file.

2. Open `apps/web/.env.cota-sponsor.local` in your editor. Copy its `COTA_SPONSOR_PRIVATE_KEY` line into `apps/web/.env`. Keep the `0x` prefix. Do not paste the key into chat, source code, or a `NEXT_PUBLIC_` variable.

3. Confirm which public address the configured key controls:

   ```sh
   pnpm --filter @proof/web run cota:sponsor address
   ```

   This command uses the key in `apps/web/.env` first, falling back to the generated local key file. Fund the address it prints.

4. Open the [official Nervos testnet faucet](https://faucet.nervos.org/). Paste the public `ckt1...` sponsor address into **Send CKB to**, then choose **Claim**. Use free testnet CKB; do not send your grant's mainnet CKB. Request 10,000 test CKB if that amount is offered; it is sufficient for a small onboarding trial. The faucet currently states a per-address monthly maximum of 300,000 CKB; its options and availability may change.

5. Wait for the faucet claim to be processed, then check the balance:

   ```sh
   pnpm --filter @proof/web run cota:sponsor balance
   ```

   A typical registration reserves 150 CKB plus a small transaction fee. Keep additional capacity for the sponsor's change output. Set the sponsorship limit to 1 for the first live test.

6. Apply the identity database schema using the instructions below. Keep `COTA_SPONSOR_ENABLED=false` until the schema is ready.

7. Add these settings to `apps/web/.env`, alongside the generated private-key setting:

   ```dotenv
   COTA_SPONSOR_ENABLED=true
   COTA_SPONSOR_MAX_REGISTRATIONS=1
   CKB_TESTNET_RPC_URL=https://testnet.ckb.dev/
   COTA_REGISTRY_URL=https://cota.nervina.dev/registry-aggregator
   NEXTAUTH_URL=http://localhost:3000
   ```

   Keep your existing `NEXTAUTH_SECRET`, GitHub OAuth settings, and database URL. `NEXTAUTH_URL` must match the origin you actually open in the browser. For a deployed app, configure its HTTPS origin and server-side environment settings instead.

   Local development is pinned to port 3000. Open `http://localhost:3000` and set the GitHub OAuth App's authorization callback URL to `http://localhost:3000/api/auth/callback/github`. If port 3000 is occupied, stop the stale Rivet server before starting again. A server on port 3001 with OAuth pointing to port 3000 causes `ERR_CONNECTION_REFUSED` after GitHub redirects back.

   If sign-in returns `OAuthCallback`, check the server's `[next-auth][error][OAUTH_CALLBACK_ERROR]` message. `outgoing request timed out` means the server could not finish a GitHub request in time. Rivet allows 30 seconds for these OAuth requests because slow DNS or network connections can exceed the library's 3.5-second default. If it still times out, check this machine's DNS and connection to `github.com` and `api.github.com`. Start a fresh sign-in after fixing connectivity; do not reload an old callback URL. Keep callback codes and tokens out of shared logs.

8. Restart the app with `pnpm dev`. Sign in with GitHub, open the dashboard, choose **Connect Wallet**, and select **JoyID on CKB testnet**. Create/select your JoyID account and approve the passkey interaction. Then choose **Activate identity** and approve the ownership message. The sponsor funds the CoTA registration; your JoyID wallet does not need test CKB for this step.

9. Wait for **CoTA identity active**, open **View transaction**, and verify the identity output belongs to the JoyID wallet. Record that transaction in `PHASE_ONE_MILESTONES.md`. Disconnect/reconnect and retry activation to check that a second subsidy is not created. Increase the sponsor limit only after this first test passes.

The helper does not claim faucet funds or enable sponsorship automatically. Live JoyID connection, ownership verification, and sponsored CoTA activation have passed. The [confirmed testnet registration](https://pudge.explorer.nervos.org/transaction/0x7e96a61e9cf8843712e789f8b80bb33bcdcecaa2d0ea0a37bfb6933d1e06f410) created a 150 test CKB identity cell at output 1, locked to the verified JoyID wallet. Registration starts with an empty SMT root; later approved record updates consume and replace this cell as described below.

If activation reports that the CoTA registry could not be reached, keep the verified wallet connected and retry activation. Registry requests allow 30 seconds for DNS, connection, and response handling. A slow DNS lookup can exceed the default connection timeout of a plain server-side `fetch` even when the registry is online. Server logs identify the failed activation stage and error code without including private keys or signed transactions. A verified wallet alone does not mean a CoTA transaction has been submitted; check the activation status and transaction link.

CKB RPC calls on the server use the configured HTTP endpoint directly, with a 30-second total timeout, without the SDK's implicit WebSocket fallbacks. If dual-stack connection attempts repeatedly return `ETIMEDOUT` while IPv4 works, set `CKB_RPC_IP_FAMILY=4` in the server environment and restart the app. This bypasses IPv4/IPv6 connection selection for those RPC requests; leaving the setting empty uses Node's default address selection. The setting also accepts `6` for an IPv6 network. Status polling shares requests already in progress, so a slow request does not start overlapping copies. Once a registration is confirmed, loading activation status uses the saved confirmation rather than contacting the node again. Temporary status errors clear after a successful check; a transaction validation error remains visible for review. A genuine node or network outage can still return HTTP 503 and does not discard a saved update or signature.

Duplicate `ccc-*` custom-element warnings can occur during Next.js development hot reload. They are separate from server RPC timeouts. Keep port 3000 for local OAuth and use `pnpm --filter @proof/web exec next build` to check a production build without running the database-mutating package build script.

### Applying the schema

Apply the additive schema update before starting the updated app or signing in. The generated Prisma client selects `User.ckbAddressVerifiedAt` in existing user queries too, so the schema is required even while sponsorship is disabled.

For an existing database, run this command from the repository root:

```sh
pnpm --filter @proof/web run identity:setup
pnpm --filter @proof/web exec prisma generate
```

The setup command loads `.env.local` and `.env`, adds the nullable verification timestamp and both identity tables in one transaction, and preserves existing data. It safely skips an already installed schema and stops if it detects a partial installation. Restart `pnpm dev` after setup, then retry GitHub sign-in. An error saying `User.ckbAddressVerifiedAt` does not exist means this update has not been applied to the database used by the app.

For a fresh development database, use `pnpm --filter @proof/web exec prisma db push`.

Regenerate the client with `pnpm --filter @proof/web exec prisma generate` after the schema is available locally. Code generation does not update the database.

If `DATABASE_URL` is already exported in your terminal and points to the intended existing development database, the additive SQL can be applied with:

```sh
psql "$DATABASE_URL" --single-transaction --set ON_ERROR_STOP=1 --file apps/web/prisma/identity-onboarding.sql
pnpm --filter @proof/web exec prisma generate
```

Next.js loading a value from `.env` does not export that value into your terminal. The `identity:setup` command handles loading these files for you. Apply either `identity:setup`, the manual SQL upgrade, or `prisma db push` on a fresh development database. The package `build` script now only generates Prisma and builds Next.js; it does not update the database. For an existing deployment, run `pnpm --filter @proof/web run release:setup` once against its intended database before deploying these updates; this also installs persistent worker limits.

Set these server-side variables in the web deployment:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_URL` | Canonical app origin; mutation requests must come from this origin |
| `COTA_SPONSOR_ENABLED` | Set to `true` to allow new sponsored registrations; defaults to disabled |
| `COTA_SPONSOR_PRIVATE_KEY` | Dedicated funded CKB testnet sponsor key; never exposed to the frontend |
| `COTA_SPONSOR_MAX_REGISTRATIONS` | Lifetime limit for new sponsored registrations; defaults to 10 |
| `CKB_TESTNET_RPC_URL` | HTTP CKB testnet node/indexer endpoint |
| `CKB_RPC_IP_FAMILY` | Optional `4` or `6` to select the RPC connection's IP family; empty uses Node defaults |
| `COTA_REGISTRY_URL` | Testnet CoTA registry aggregator endpoint |

When sponsorship is disabled, users can still connect and verify their JoyID wallet. No subsidy is spent. An existing confirmed CoTA cell can be associated with the verified account without creating another cell.

Registration uses at least 150 CKB, increasing only if the output's occupied capacity requires it. Transaction fees are capped at 0.01 CKB. The sponsor also needs sufficient spendable capacity for fees and change. Never reuse a user key or a mainnet funding key as this sponsor.

The PostgreSQL advisory lock serializes wallet linking and registration preparation across server instances. Only one newly sponsored registration may be awaiting confirmation at a time to avoid conflicting sponsor inputs. Other requests receive a retry message. A rejected transaction needs operator inspection before the signed record is repaired or replaced; do not delete it and issue another subsidy blindly. If a transaction remains pending, check its stored hash and the registry transaction before intervening.

## Verification

Run `pnpm --filter @proof/web test` for passkey signature, challenge binding, credential ownership, CoTA output ownership, capacity, full sponsor signing, and registry transaction checks. Default tests use generated keys and mocked services; they do not spend CKB. The PostgreSQL integration test is skipped unless `RIVET_TEST_DATABASE_URL` points to a disposable database with the identity schema applied. It replaces `DATABASE_URL` only inside its isolated test process and cleans up the users it creates.

Local verification completed on October 21, 2026: all 21 checks passed with a temporary PostgreSQL database, including simultaneous attempts to consume the same challenge and resending a persisted registration transaction after a broadcast failure. The additive SQL upgrade matched the Prisma schema with no differences, and the Next.js production build passed. No testnet transaction was broadcast.

Manual testnet acceptance:

- [x] Apply the identity schema and enable a funded testnet sponsor.
- [ ] Sign in with GitHub and complete a backup with no wallet connected.
- [x] Create/connect a JoyID account on a supported device and verify ownership.
- [x] Confirm that registration locks the CoTA cell to the user's wallet and only the sponsor supplies inputs and fees.
- [ ] Repeat activation and verify that it reuses the registration without another subsidy.
- [ ] Check cancellation, expired/replayed challenges, another user's wallet, and RPC/aggregator outages.
- [ ] Disconnect/reconnect and confirm that identity ownership persists.
- [x] Save the confirmed registration transaction hash in the milestone completion log.

### Signed identity and backup proofs

Run these additive setup commands before using record sync on another installation, then restart the app:

```sh
pnpm --filter @proof/web run cota:setup
pnpm --filter @proof/web exec prisma generate
```

The setup adds a `protocol` column to `CotaUpdate`. Existing attempts receive `cota-smt-v1`; the new opt-in path uses `rivet-witness-v1`. A unique index on account, source outpoint, and protocol allows a new signed-proof attempt to coexist with the incompatible CoTA extension attempt. Existing signatures, registrations, and backups are preserved. Setup uses the app's Prisma connection and applies its SQL in one transaction.

1. Open `/dashboard#identity`, disconnect, and reconnect the same JoyID wallet. The saved verification and original registration must remain present. Connecting a different wallet must not replace the registered identity or enable record signing.
2. Read the signed-proof explanation and choose **Prepare signed proof**. This explicitly chooses to publish records in a signed transaction witness while preserving the CoTA SMT. The server includes the developer identity and latest completed public repository proofs. Each backup anchor is checked for confirmation and its Merkle root is read from its transaction output. Private repositories and encryption keys are excluded. Preparation displays the exact new fee and does not open JoyID.
3. Review the public records, record commitment, preserved CoTA root, and fee, then choose **Review and approve in JoyID**. Use the primary passkey. The transaction consumes and replaces the existing identity cell with the same wallet lock, CoTA type, and cell data. A fee below 0.01 test CKB is deducted from that cell's capacity. No new registration subsidy is created. The old attempt's 0.00014576 test CKB quote does not apply to this newly prepared transaction.
4. The server persists the approved transaction, runs `test_tx_pool_accept`, and broadcasts only after validation passes. Wait for **Signed identity and backup proofs confirmed**, then inspect output 0 through **View records transaction**. Use **Download identity proof** to save the records, commitments, unchanged CoTA root, witness payload, approved transaction, and transaction reference.
5. Refresh and reconnect. Choose **Sync signed identity proofs** without changing records: it must report that the proofs are already synchronized and avoid another signature, transaction, or fee. A new completed public backup can be included in a later signed proof.
6. Cancel JoyID approval and retry: the same unsigned attempt returns. If broadcasting fails after signing, **Retry signed proof submission** reuses the persisted signature. Confirmations must contain the exact prepared proof witness; a transaction with the same raw hash and different witness data is rejected by the app's confirmation check.

Approval of a displayed prepared proof opens JoyID directly; it does not prepare the transaction again. Continuing an existing proof uses a read-only lookup before attempting any new database transaction. Database connection and pool startup default to 15 seconds unless `DATABASE_URL` explicitly configures `connect_timeout` or `pool_timeout`. A failed read caused by `P1001` is retried once. Database timeout responses identify the connection issue and preserve the prepared proof. If submission fails after wallet approval, the page also keeps that signed transaction in memory for a retry while the page stays open; only a successfully persisted signature survives a page reload. On October 24, `P2028` during preparation prevented the 0.00013744 test CKB proof from reaching JoyID approval; the saved proof and fee were unchanged by recovery.

An RPC `-302` response is a transaction validation failure, distinct from a connection outage. The records API returns HTTP 422 for this failure and identifies the failing script and its exit code when available. On October 24, the saved signed trial update was rejected by input 0's JoyID lock with script error 16, reproduced with both testnet validation and the local CKB debugger. Its saved fee remains 0.00014576 test CKB. Repeating the same submission does not repair this validation failure. Preserve the update for investigation; do not delete the signature, issue another subsidy, or report the records as confirmed. Server logs include the request stage and nested connection error codes without logging signed transactions. Intermittent RPC connection failures still return HTTP 503.

October 24 diagnosis: the saved WebAuthn signature verifies cryptographically, its public key matches the wallet lock, and its challenge matches the transaction sighash. Local tests against the deployed JoyID binary reject the custom `rivet1` extension with exit code 16 under both `0xF0` and `0xF1`, while the CoTA type script accepts those proofs. The JoyID extension check recognizes `subkey` and `social`; using those namespaces for application records would conflate application data with wallet authorization or recovery. Reconnecting, changing the fee, or signing the same extension again does not resolve this incompatibility.

The implemented alternative places a UTF-8 JSON envelope in witness 0's `outputType`, leaving `inputType` empty. Its protocol is `rivet-witness-v1`, version is 1, and network is `ckb-testnet`. The envelope binds the wallet lock hash, source outpoint, previous confirmed proof's transaction hash, record commitment root, preserved CoTA root, and public records. The JoyID signature covers the witness. The record commitment is a Rivet record-tree root; the CoTA cell's root remains unchanged. Verifiers must obtain and validate the committed transaction witness rather than look for these records in the CoTA SMT. This alternative does not complete the milestone requirement to store identity and backup records in that SMT.

The currently incompatible builder uses the CoTA `0xF1` extension witness with six-byte subtype `rivet1`. Keys are `ff00 || UTF8("rivet1") || CKB_HASH(name)[0..24]`, where names are `developer` or `backup:<lowercase owner/repository>`. Values commit to UTF-8 JSON using `ckb-default-hash` BLAKE2b-256. Developer fields serialize in the order `kind, version, network, githubId, githubUsername, walletLockHash`; backup fields serialize as `kind, version, network, repository, ipfsCid, merkleRoot, anchorOutpoint, commitCount`. Unknown extra fields sort by name. This keeps commitments stable across PostgreSQL JSONB key reordering. Raw records are also retained in the extension witness, making approved records public on testnet.

The signed-proof path supports one developer record and up to 127 public repository records. It preserves all existing CoTA data, including unknown wallet authorization or recovery entries. Use the primary JoyID passkey. Completed backup proofs can be synchronized later; ordinary GitHub backups do not require an immediate wallet signature. Unsupported legacy attempts appear as blocked and cannot be rebroadcast through the records API.

The contract regression test executes the new builder's transaction against the deployed JoyID and CoTA binaries using a generated test passkey. Both scripts return 0; an altered witness fails JoyID validation, a changed CoTA root fails type validation, and the legacy extension reproduces JoyID error 16. Enable this optional test with `RIVET_CKB_DEBUGGER` set to the CKB debugger executable and `RIVET_CKB_FIXTURE` set to a debugger fixture containing the deployed dependencies and a CoTA input. These checks do not substitute for the owner's live approval or testnet confirmation.

#### Reproducing the compatibility blocker

The fixture can now be reconstructed from public testnet data without application credentials, database access, or a wallet. From the repository root:

```sh
pnpm --filter @proof/web run cota:fixture --output /tmp/rivet-cota-fixture.json
RIVET_CKB_DEBUGGER=/path/to/ckb-debugger \
RIVET_CKB_FIXTURE=/tmp/rivet-cota-fixture.json \
pnpm --filter @proof/web exec tsx --test tests/identity-proof-contract.test.cjs tests/cota-smt.test.cjs
```

Use the official [CKB debugger release](https://github.com/nervosnetwork/ckb-standalone-debugger/releases) for your platform and verify its published SHA-256 before execution. The October 27 run used v1.1.1 on Linux x86-64. Download the debugger outside the repository; binaries and the generated fixture are not application dependencies.

The downloader defaults to the confirmed signed-proof transaction above. It retrieves its input and all code/dependency-group cells from committed transactions, including the consumed registration output. It requires a testnet JoyID-owned CoTA input with an empty SMT, refuses existing output files, and does not load `.env` files. Optional `--rpc` and `--transaction` flags select another HTTP endpoint or compatible public transaction. The historical input is a local simulation fixture, not a spendable input for another live transaction.

October 27 verification: five tests passed with none skipped. With a freshly generated primary passkey, both `0xF0` and `0xF1` accept developer/public-backup commitments under the deployed CoTA type script (exit 0), but fail the deployed JoyID lock (exit 16). Signed-witness proofs pass both scripts; witness tampering and an unauthorized root change fail. No transaction was broadcast. This confirms the current custom extension cannot be enabled merely by changing the extension action. It does not establish a compatible replacement protocol or complete the SMT milestone. Keep the legacy submission path blocked until a candidate passes both deployed scripts and owner-approved testnet acceptance.

- [x] Automated reconnect/repeated-activation, persistence, and retry checks.
- [x] Validate SMT roots and witnesses against the deployed CoTA type script offline.
- [x] Validate the signed-proof builder against both deployed scripts with a generated test passkey.
- [x] Complete the primary-passkey signed-proof transaction and record its testnet confirmation. Independently verified October 25: [committed transaction](https://pudge.explorer.nervos.org/transaction/0x2aa15bc36a911eb0f565a6b2820c4df8ebbf7ff2b73d4cc70d9ffa27bc4936d2), output 0 live and owned by the verified JoyID wallet, fee 0.00013744 test CKB, capacity 149.99986256 test CKB. The witness includes developer identity and `Amentor-coder/testing`; its recomputed record commitment matches `0xdad48c4281d8b21726debfbd0fd9612a709e18101c72806eaf7c6e661048bd72`, and the backup Merkle root matches its confirmed anchor output. CoTA cell data is preserved with an empty SMT root.
- [ ] Resolve JoyID compatibility for the original CoTA SMT record requirement.
- [ ] Complete browser disconnect/reconnect and unchanged-sync acceptance on the confirmed records.

## Remaining milestone work

Registration initialized an empty CoTA tree. Signed witness proof anchoring has completed live owner approval and testnet confirmation; the original registration output has been consumed and replaced by the same owner's live cell. Browser reconnect and unchanged-sync acceptance remain pending. The original CoTA SMT record requirement remains blocked by JoyID extension compatibility. Sovereign Passport minting and public profile integration remain pending. A confirmed registration or witness proof alone does not complete Milestone 1.

## Protocol references

- [CoTA registration builder](https://github.com/nervina-labs/cota-sdk-js/blob/develop/src/service/registry/index.ts) and [testnet script deployments](https://github.com/nervina-labs/cota-sdk-js/blob/develop/src/constants/index.ts).
- [CoTA registry RPC](https://github.com/nervina-labs/cota-registry-aggregator#apis).
- [JoyID signature and credential verification](https://github.com/nervina-labs/joyid-sdk-js/blob/main/packages/ckb/src/verify.ts).
- [Official Nervos testnet faucet](https://faucet.nervos.org/) and [CCC documentation](https://docs.nervos.org/docs/sdk-and-devtool/ccc).
- Installed CCC source for signer message verification and JoyID connection/signing is used by the integration.
- [CoTA extension schemas](https://github.com/nervina-labs/cota-smt/blob/develop/src/extension.mol), [extension proof generation](https://github.com/nervina-labs/cota-aggregator/blob/develop/src/entries/extension.rs), and [Nervos SMT merge/proof implementation](https://github.com/nervosnetwork/sparse-merkle-tree).
