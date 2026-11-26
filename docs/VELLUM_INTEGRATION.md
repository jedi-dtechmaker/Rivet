# Vellum integration

Rivet can link one controller-verified `did:ckb` identity to a GitHub account, show that identity's current Vellum reputation on a public profile, and issue one `rivet.repository-backup.v1` Claim Cell for each eligible public repository backup.

The integration is optional. Repository backup and recovery do not depend on Vellum, and a Vellum RPC, reputation API, or issuer failure cannot change a successful backup into a failed one.

## Identity linking

The identity page accepts a canonical active `did:ckb`. Rivet resolves the live DID controller and creates a five-minute challenge containing the deployment origin, immutable GitHub account ID, DID, controller lock hash, random nonce, and expiry. The connected controller wallet signs that exact message. Rivet resolves the DID again, rejects controller rotation, verifies both the message signature and controller lock, and consumes the challenge once.

A DID can belong to only one Rivet account. Relinking requires a fresh controller proof. Public display and backup claim issuance require an explicit public opt-in. Making the binding private or unlinking it stops new claim records from being created; it cannot cancel an exact transaction already prepared for safe retry or remove a Claim Cell already published on-chain.

Public profile reads resolve the current controller again. A changed or unavailable controller is shown as such, and reputation is not presented as current until the binding verifies. Reputation comes from Vellum's public API and is display-only: Rivet backup and recovery paths do not use it for authorization or availability.

## Backup claim

Schema: `rivet.repository-backup.v1`

Schema hash: `0x53165e4ecfb86396f39b777bd7dca5b15994ae5ae2c330f0a4e49b733ab1b780`

The payload contains:

- immutable GitHub user and repository IDs;
- the public repository name;
- the committed backup transaction and output index;
- anchor version `2`, commit count, and block timestamp.

Before reserving a claim, Rivet verifies that the repository and linked identity are public, the DID controller is unchanged, the GitHub IDs are canonical decimal IDs, the saved transaction is committed at the expected outpoint, and the output contains a matching v2 anchor. Private repository contents, encryption material, GitHub credentials, IPFS credentials, and recovery secrets never enter the claim.

The database enforces one issuance record per repository. A cryptographic nonce and exact payload are persisted before preparation. Rivet then persists the exact signed transaction and its hash before broadcasting it. Retries reuse those bytes. A database-backed issuer lease serializes transaction preparation and broadcast so concurrent backup callbacks cannot race the issuer's capacity inputs. Rejected or mismatched committed transactions are retained for review instead of being rebuilt silently.

## Deployment

Install the additive tables before enabling the UI in a deployment:

```sh
pnpm --filter @rivet/web vellum:setup
```

`release:setup` also includes this migration. It preserves existing users, repositories, backups, identity records, and signed transactions, and refuses a partially installed Vellum schema.

Identity linking and reputation reads do not require issuer credentials. Claim issuance remains disabled unless every issuer value is set:

```dotenv
RIVET_VELLUM_ISSUER_ENABLED="true"
RIVET_VELLUM_ISSUER_DID="did:ckb:..."
RIVET_VELLUM_ISSUER_CKB_PRIVATE_KEY="0x..."
RIVET_VELLUM_MIN_CONFIRMATIONS="1"
VELLUM_API_URL="https://dashboard.usevellum.xyz"
VELLUM_PROFILE_URL="https://usevellum.xyz"
```

Use a dedicated funded issuer key. On every preparation Rivet resolves `RIVET_VELLUM_ISSUER_DID` and confirms that the configured key controls its live controller lock. Keep the private key in the deployment secret store; never expose it through a `NEXT_PUBLIC_` variable, worker payload, log, fixture, or browser response.

The example uses one confirmation so the authenticated backup callback can issue immediately after Rivet confirms the anchor. A deployment may require a greater depth; those candidates remain pending until another authenticated claim reconciliation runs after the configured depth is reached.

After enabling issuance, link a DID, opt into public sharing, complete a public backup, and inspect the identity page. The claim progresses from preparation through submission and confirmation. The backup callback and authenticated claim retry endpoint both reconcile persisted state. Confirm the Claim Cell's subject, issuer, schema hash, payload, source anchor, and transaction through Vellum and the explorer before treating the deployment as accepted.
