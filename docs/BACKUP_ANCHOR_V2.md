# Backup anchor v2

The Milestone 2 worker and recovery CLI share a versioned payload implemented in [`anchor.mjs`](../packages/cli/src/anchor.mjs). New backups bind repository commits, refs, bundle bytes, CID and count to one CKB Testnet output. This is source implementation documentation; live deployment and testnet acceptance are tracked in the [Milestone 2 plan](./MILESTONE_TWO_PLAN.md).

## Cell data

CKB output data is the hex encoding of these concatenated bytes. There is no trailing padding or JSON envelope.

| Byte offset | Length | Value |
| --- | --- | --- |
| 0 | 4 | `52 56 54 02`: ASCII `RVT` and version 2 |
| 4 | 32 | Commit-set Merkle root |
| 36 | 32 | SHA-256 of canonical refs |
| 68 | 32 | SHA-256 of the plaintext Git bundle |
| 100 | 4 | Commit count, unsigned big-endian integer, at least 1 |
| 104 | 1 | ASCII CID length |
| 105 | CID length | CID of the uploaded encrypted bundle |

The supported CID forms are base58 CIDv0 (`Qm…`) and lowercase base32 CIDv1 (`b…`). Decoders reject malformed lengths, counts and CIDs, unknown versions, and trailing bytes. A bare 32-byte output remains a legacy v1 Merkle root.

## Commit and ref commitments

Enumerate all reachable commits with `git log --all --format=%H`, sort the lowercase object IDs in ascending byte order, then build the Merkle tree. Each leaf is SHA-256 of the ASCII object ID. Each parent is SHA-256 of the concatenated binary child digests; an odd final child is promoted unchanged. Legacy backups retain their original unsorted Git traversal order during verification.

Enumerate refs with `git for-each-ref --format="%(refname) %(objectname)"`. Sort rows by refname's UTF-8 bytes, reject duplicate names, and join as `refname SP object-id LF`, including the final newline. Hash those UTF-8 bytes with SHA-256. Annotated tags commit their tag object IDs, rather than substituting their peeled commit IDs. The commitment covers `refs/*`; symbolic `HEAD`, Git configuration, reflogs, hooks, and working-tree files are outside this representation.

Create the bundle with `git bundle create <file> --all`. Compute its SHA-256 before AES-256-GCM encryption. The uploaded bytes remain ciphertext followed by the 16-byte authentication tag; the recovery file supplies the key and IV. Binding the plaintext digest allows byte verification after decryption, and binding the encrypted CID fixes the expected storage reference. These commitments do not ensure the file remains available.

## Recovery files and independent checks

`rivet-backup-proof-v2` retains the v1 fields (`network`, `repository`, transaction hash, output index, CID, Merkle root and commit count), adding `refsHash` and `bundleSha256`. Recovery secrets remain optional in status output and are exported only with `--proof-out`.

Verification first reads the committed transaction and compares the complete payload against the recovery file. It checks that the returned block header hash matches the transaction's block reference. It then decrypts the downloaded or local bundle, verifies its SHA-256, expands a temporary bare mirror, runs `git fsck --full --strict`, recomputes the sorted commit root and refs hash, and creates a new destination only after those checks pass. Existing paths, including empty directories, are rejected.

CoTA manifest preparation and independent verification decode both versions. V2 checks also compare the manifest's CID and commit count against the anchor. Public backup lookup and CLI status use the same decoder. No database migration is required; the format and added fields come from the on-chain output.

These checks trust the selected RPC's committed status and chain data. They do not independently verify block headers, GitHub account ownership, commit dates, or the absence of a newer backup. The recovery file's repository name is a label; issuer-authenticated GitHub associations belong to the CoTA manifest.

## Anchor lifecycle and capacity

Output 0 is the successor backup anchor. If a previous outpoint is configured, the worker checks that it is live, untyped, under the treasury lock, and contains a supported anchor. It consumes that cell and preserves at least its old capacity, adding funding when the v2 payload requires more space. A standard 20-byte secp lock with a 46-byte CID needs 212 test CKB of occupied capacity (`61 + 105 + 46`), separate from fees. Capacity is calculated from the actual lock and payload.

Malformed, spent, foreign, or unavailable predecessor cells stop the attempt. A failed or uncertain submission does not trigger another transaction using a fresh anchor. Operators must inspect the workflow's transaction and saved outpoint before retrying. A queued backup whose saved predecessor has since advanced may therefore require reconciliation; automatic queue reconciliation remains hardening work.
