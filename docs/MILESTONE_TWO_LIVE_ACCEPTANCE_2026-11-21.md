# Milestone 2 live acceptance — November 21, 2026

Status: Milestone 2 implementation and project acceptance are complete. The live v2 backups, exact recovery, attribution recovery, signed mapping and separate testnet anchor, negative checks, production deployment, and public `cli-v0.1.0-rc.3` release are verified. The owner selected GitHub source publication for the final documentation and public evidence. Funded Phase One project delivery is complete; community/reviewer sign-off remains separate. The next proposed scope is [Phase Two production readiness](./PHASE_TWO_PLAN.md).

## Repository and artifacts

- Repository: [jedi-dtechmaker/DEXsol-skannar](https://github.com/jedi-dtechmaker/DEXsol-skannar), three commits.
- Added acceptance refs point to existing commits: branch `rivet-acceptance-20261121` and annotated tag `rivet-acceptance-20261121`. The snapshot contains two branches and one annotated tag.
- The installed 0.1.0 CLI dispatched the hosted backups. The fixed CLI candidate from commit `f5a52a8215b7684287de6f5376f28f75bff1b628` was independently downloaded from the successful workflow, checksum-verified, installed into a temporary prefix, and exercised against the live backup and signed mapping outside the checkout.
- [Public release `cli-v0.1.0-rc.3`](https://github.com/jedi-dtechmaker/Rivet/releases/tag/cli-v0.1.0-rc.3) was published after its [release workflow](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44851633570) passed Linux x64, macOS arm64, and Windows x64 package/native checks. The separate [tag checks](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44851633573) also passed. Every public archive/executable was downloaded and matched its published SHA-256 and GitHub asset digest.
- The public npm archive was installed into a clean temporary prefix. Outside the checkout, it passed version/help, exact recovery, complete commit/ref comparison, `git fsck`, signed mapping/anchor verification, and live login/status/logout with isolated credentials. The downloaded Linux standalone executable independently verified the same signed mapping and its confirmed anchor. macOS and Windows installed-command execution is established by the release matrix; live-chain execution here was on Linux.
- [Security PR #3](https://github.com/jedi-dtechmaker/Rivet/pull/3) merged as `92d648fa43970fad7b30bf4d951e19ea284c166c`. Its [main checks](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44850418650) and production Vercel deployment passed; the public site returned HTTP 200. The earlier live backup workers ran from `fc43a62920db97c6bc6f1e4085442e8fddecadff`. Their results establish the durable backup flow; the separate deployment record establishes rollout of the dependency security fixes.

## Confirmed backup anchors

| Snapshot | Transaction | Block | Anchor capacity | Fee |
| --- | --- | --- | --- | --- |
| Existing legacy backup | [f038aeb4…](https://pudge.explorer.nervos.org/transaction/0xf038aeb4d3a1c520fce05fc3df61f3635ca864f5e99a21adddbec3e635e4d12f) | 22986143 | 93 test CKB | Historical baseline |
| First live v2 backup | [8bb202bc…](https://pudge.explorer.nervos.org/transaction/0x8bb202bcf2bb9915f646ba2aa6bf4294a10da11a8eb892ff3daa434063d4d145) | 23131379 | 225 test CKB | 0.00000672 test CKB |
| Second live v2 backup | [707f7244…](https://pudge.explorer.nervos.org/transaction/0x707f7244eb11df3e8928a0d490dafee3d315220ffa0db575f03b508b654b9d65) | 23131463 | 225 test CKB | 0.00000672 test CKB |

Public RPC reads verified both transactions consume the previous anchor and each creates exactly one v2 successor. The first transition adds 132 test CKB of occupied capacity. The second preserves capacity. The second v2 output is live; the first is consumed by the committed second transaction. The RPC reports `unknown` for that consumed cell, so its spend is established by the confirmed transaction input rather than a `dead` response.

The first worker [completed successfully](https://github.com/jedi-dtechmaker/Rivet/actions/runs/44847608068). The initial second-backup request lost its HTTP response. Its successor had not appeared in hosted status or workflow history before a manual request through the server's reservation/coalescing path created the recorded second job. There was no automatic POST retry, database repair, predecessor reset, or replacement signed transaction.

## Recovery results

- Public-gateway verification checks the complete v2 anchor, decrypted bundle SHA-256, commit root, refs commitment, and Git integrity.
- Exact recovery matches all three original commits and all three refs, including the annotated tag object. `git fsck --full --strict` passes.
- Recovery used an empty credentials directory, an unavailable Rivet origin, a fetch guard allowing only CKB RPC and public IPFS gateways, and `GIT_ALLOW_PROTOCOL=file`. The fixed candidate recovered from the saved encrypted bundle after the local source mirror was moved out of its original path. These controls cover the CLI's fetch calls and Git transport; they are not an operating-system-wide network sandbox.
- Attribution recovery retains the exact original mirror and rewrites a separate local mirror. The demonstration remaps the source email to reserved-domain `acceptance@rivet.example`; it makes no GitHub contribution-graph claim. Every commit mapping and rewritten ref is independently reproduced, and the owner signature verifies.
- Five negative checks reject a wrong AES key, altered refs commitment, modified encrypted bundle, tampered mapping signature, and an existing restore destination. The existing destination's refs remain intact.

The default `ipfs.io` gateway could not serve the fresh bundle during this run. The public `https://gateway.pinata.cloud/ipfs/` gateway returned the 49,912-byte ciphertext, and independent verification passed with `--gateway`. Recovery from its saved ciphertext also passed. This records gateway availability separately from proof validity.

## Confirmed mapping anchor and acceptance

The verified signed mapping digest is `0xb48332694b9924e211e1e309ab5eb0662b0d755e0d25a7f90ee5829827e7d792`. Its Ed25519 owner-key fingerprint is `0x4bd3634d95988d3e07061a4be22097a7e4dae5f238e0791c974fedc02dbd83a8`. Publishing this evidence through the repository owner's GitHub channel provides reviewers the public key through that established channel; embedding a key in the mapping alone is insufficient.

The owner approved completion of the remaining work on November 21, 2026. The exact prepared transaction was revalidated, signed, saved privately before broadcast, and confirmed as [mapping transaction `09e362fc…`](https://pudge.explorer.nervos.org/transaction/0x09e362fcb0c7c61e04a2d1266ce10cc9474a819b45b0224670171d2487251010) in block **23131676**, output **0**. It consumes the approved empty, untyped treasury change cell, creates a **97-test-CKB** mapping cell under the same treasury owner lock, returns change to that owner, and pays **500 shannons (0.000005 test CKB)**. The approved transaction hash did not change during signing. No replacement transaction was created.

Independent public RPC verification confirms the mapping data is `0x52564d01` followed by the signed-document digest, the owner lock and fee match the approval, and both the new mapping cell and latest backup anchor remain live. The mapping transaction spends treasury change at output 1 of the second backup transaction; it leaves that transaction's backup anchor at output 0 untouched. The published npm CLI and Linux executable reproduce every commit mapping and verify both source and mapping block headers without a Rivet login.

- [x] Approve and merge security PR #3; verify green `main` checks and the production deployment.
- [x] Publish the refreshed CLI and verify all public release assets/checksums.
- [x] Approve the treasury use, confirm the prepared mapping transaction, and verify the separate anchor through the published CLI.
- [x] Publish the acceptance record and checksummed public evidence as repository source files and mark Milestone 2 project acceptance complete. Community/reviewer sign-off remains separate.

## Evidence and reproduction

The final acceptance record, reproduction guides, and [public evidence directory](./evidence/milestone-two-2026-11-21/) are published as source files in the owner's GitHub repository. The CLI executables and npm archive remain available in the [public release](https://github.com/jedi-dtechmaker/Rivet/releases/tag/cli-v0.1.0-rc.3). The signed mapping, owner public key, and fingerprint in this record are distributed through the owner's repository channel.

The [evidence directory](./evidence/milestone-two-2026-11-21/) contains public proofs, source commits/refs, the signed attribution mapping and owner public key, comparison results, transaction lifecycle and fee checks, deployment records, public release provenance/checksums, and negative-check results. [SHA256SUMS.json](./evidence/milestone-two-2026-11-21/SHA256SUMS.json) hashes those files. The original unsigned proposal and unanchored candidate checks are retained as historical preparation records; `mapping-anchor-confirmed.json`, `mapping-anchor-lifecycle.json`, and the public-release checks record the final result. Recovery AES keys/IVs, GitHub tokens, CKB private keys, and the Ed25519 private key are excluded.

After checking out this documentation, installing the release, and receiving the private recovery file and encrypted bundle from the owner through an authorized private channel, reproduce the anchored attribution check:

```sh
rivet verify-mapping \
  --mapping docs/evidence/milestone-two-2026-11-21/attribution-mapping.json \
  --owner-key docs/evidence/milestone-two-2026-11-21/owner-key.pub \
  --proof /private/location/first-v2-recovery.secret.json \
  --bundle /private/location/first-encrypted.bundle \
  --target /private/location/attribution-recovery/rewritten.git \
  --anchor 0x09e362fcb0c7c61e04a2d1266ce10cc9474a819b45b0224670171d2487251010 \
  --output-index 0
```

Private recovery material and the saved encrypted bundle are in the owner-only local acceptance workspace `/tmp/rivet-m2-dexsol.uk3gkm/private`. The original mode-0600 archive remains at `.milestone-two.secret.20261121/acceptance-workspace.tar.gz`; a final `acceptance-workspace-complete.tar.gz` also preserves the confirmed signed receipt and final results. Their mode-0700 directory is confirmed ignored by Git. These archives contain recovery secrets and must remain private. Reviewers who are authorized to access the recovery material can reproduce the commands in the [CLI guide](../packages/cli/README.md#restore), using the public key and signed mapping in the evidence directory. Public commitments alone do not decrypt the encrypted repository snapshot.
