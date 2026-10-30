# Rivet CLI (Milestone 2 development)

Source CLI for Node.js 24+ and Git on Linux, macOS and Windows. Standalone binaries, registry publication and attribution restore are pending. From the repository root, run `node packages/cli/src/cli.mjs --help`. Use `pnpm rivet --help` as a workspace shortcut. The package declares the `rivet` executable for a future published release.

Use a GitHub personal token for the same account previously signed into Rivet. The server validates the token against GitHub for each request and requires ownership or write access for backups. Server workers use the operator credential and existing dispatch budgets; the CLI token is not forwarded to workers. Configure the app URL and token in the shell environment:

```sh
export RIVET_URL=https://YOUR_RIVET_HOST
export RIVET_TOKEN=YOUR_GITHUB_TOKEN
node packages/cli/src/cli.mjs backup owner/repository
node packages/cli/src/cli.mjs status owner/repository
node packages/cli/src/cli.mjs status owner/repository --proof-out backup.secret.json
```

`backup` waits up to 900 seconds for a newly completed, confirmed backup, then prints its CKB hash, IPFS CID and block height. It checks the dispatch time to avoid returning an older backup. Use `--timeout 1800` or `--no-wait` when appropriate; after a timeout, use `status` instead of dispatching again. Wallet connection is not required. Only public repository backups are supported on testnet.

The recovery file contains the CID, anchor reference and AES-GCM recovery material for the existing encrypted worker bundle. It is created exclusively with mode 0600; an existing file is never overwritten. Keep it private and outside version control. Default status output omits recovery keys. On Windows, protect the file with the user's filesystem ACLs; POSIX mode bits alone do not configure Windows ACLs.

```sh
node packages/cli/src/cli.mjs verify 0xTRANSACTION_HASH --proof backup.secret.json
node packages/cli/src/cli.mjs restore owner/repository --mode exact --proof backup.secret.json --target ./recovered.git
```

Verification and restore use the proof file, a CKB testnet RPC, the IPFS bundle, and Git; neither requires Rivet, the original GitHub repository, nor a token. Use `--rpc`, `--gateway`, or `--bundle /path/to/encrypted.bundle` to select independent sources or recover from a saved file. Downloaded bundles have a default 512 MiB bound (`--max-bytes`, at most 2 GiB). Exact restore creates a new bare mirror, verifies the ordered commit set, runs `git fsck`, and compares all restored refs with the verified bundle. It never overwrites a target. To get a working tree, clone the restored bare repository afterwards.

Current legacy anchors contain the ordered commit-set Merkle root. They **do not authenticate the CID, bundle SHA-256 or branch/tag refs**. The CLI verifies the supplied bundle's commits against the anchor and preserves that bundle's refs; it reports the unauthenticated-ref limitation. It trusts the selected RPC for committed status and headers, and the account's exported references for selecting the CID. An anchor proves existence by block height, not truthful Git commit timestamps. Versioned anchor payloads binding refs and bundle bytes, attribution remapping proofs, and independent release acceptance remain open Milestone 2 tasks.

Run `node --test packages/cli/test/*.test.mjs` to check encrypted bundle recovery, tampering, committed-anchor checks, and restoration after deleting the original repository.
