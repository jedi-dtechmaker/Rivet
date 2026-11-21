# Rivet CLI

Install Rivet once, sign in, then run `rivet` from your own projects on Windows, Linux or macOS. Git is required. The npm archive additionally needs Node.js 24+; standalone executables include their own Node runtime. Attribution restore also needs Python 3 and `git-filter-repo` 2.47.0. Public preview `cli-v0.1.0-rc.3` and hosted/testnet project acceptance are complete; browser OAuth is separate future work. The repository contains the live acceptance record and checksummed public evidence directory.

## Install

Versioned preview releases are distributed through [GitHub Releases](https://github.com/jedi-dtechmaker/Rivet/releases). Download the executable for your operating system and architecture, along with its `.sha256` file. Linux/macOS users can make the downloaded file executable with `chmod +x <filename>` and place it on `PATH` as `rivet`; Windows users can rename the `.exe` to `rivet.exe` and add its directory to `PATH`. The release matrix executes each artifact outside the source checkout. macOS binaries are ad-hoc signed, without Apple notarization; Windows binaries have no publisher certificate.

Verify checksums before installation using `sha256sum -c <filename>.sha256` on Linux, `shasum -a 256 -c <filename>.sha256` on macOS, or `Get-FileHash <filename> -Algorithm SHA256` in PowerShell. Match the PowerShell hash to the supplied checksum file.

Install the published preview using npm. From this source checkout, `pnpm cli:pack` builds `dist/rivet-cli-0.1.0.tgz` and its SHA-256 file without downloading dependencies. The installed CLI includes all runtime modules and does not need the Rivet checkout afterwards.

```sh
npm install --global https://github.com/jedi-dtechmaker/Rivet/releases/download/cli-v0.1.0-rc.3/rivet-cli-0.1.0.tgz
rivet --version
rivet --help
```

You can also install a downloaded archive by its absolute path. npm creates the `rivet` command on Linux/macOS and a Windows command shim. Its global executable directory must be on `PATH`.

The updated Milestone 2 server is deployed at the default hosted origin. For a configured local deployment, use `rivet login --server http://localhost:3000` after starting the app. Operators of other deployments must provide `GET /api/cli/account` together with the CLI update; this route needs no database migration.

## Sign in once

First sign into the Rivet web app with GitHub to register your account. Then run:

```sh
rivet login
```

Paste a GitHub personal access token for that same account into the hidden prompt. The token is not a command-line argument and is not echoed. The selected Rivet server checks it against GitHub and your existing account before anything is saved. This is token-based sign-in; browser OAuth is planned separately.

The default server is `https://rivet-web-ten.vercel.app`. To select another deployment, run `rivet login --server https://YOUR_RIVET_HOST`; that selection is remembered. Automation can supply a token on standard input with `rivet login --token-stdin`.

Saved credentials are bound to the exact server origin. Selecting another server does not forward a different server's saved token. `RIVET_TOKEN` and `RIVET_URL` remain optional session overrides. Use `rivet logout` to remove the selected server's saved credential; unset `RIVET_TOKEN` too if you configured that override.

Credentials are stored in a local JSON file protected by user filesystem permissions: mode 0600 under a mode 0700 directory on Linux/macOS. Windows uses the user profile's inherited ACLs; POSIX mode bits do not configure Windows ACLs. Browser sign-in and OS keychain integration remain future work.

| Platform | Default credentials file |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/rivet/credentials.json`, or `~/.config/rivet/credentials.json` |
| macOS | `~/Library/Application Support/Rivet/credentials.json` |
| Windows | `%APPDATA%\Rivet\credentials.json` |

`RIVET_CONFIG_DIR` selects another absolute configuration directory. Keep this directory outside project version control.

## Back up from a project

```sh
cd my-project
rivet backup
rivet status
```

Rivet detects `owner/repository` from the project's `origin` remote, including HTTPS, `git@github.com:owner/repository.git`, and `ssh://git@github.com/owner/repository.git` forms. Commands work from subdirectories too. You can always supply a repository explicitly, for example `rivet backup owner/repository` or `rivet status owner/repository`.

**Current backups cover public repository history pushed to GitHub. Unpushed commits, uncommitted files, arbitrary local directories and private repositories are excluded.** The worker mirrors GitHub; the CLI does not upload the local directory. The server checks repository ownership or write access and enforces existing worker budgets. The operator credential runs the worker; your personal token is not forwarded to it. Wallet connection is not required.

`backup` waits up to 900 seconds for a newly completed, confirmed backup, then prints its CKB transaction hash, IPFS CID and block height. It checks the dispatch time and previous transaction to avoid returning an older backup. Use `--timeout 1800` or `--no-wait` when appropriate. After a timeout, use `status` instead of dispatching again.

With the matching server and worker update, unchanged v2 history and refs reuse the existing confirmed, live backup without another bundle upload or CKB transaction. The CLI reports `unchanged: true` and can export that backup's existing recovery material. A worker still checks GitHub history and counts against the worker quota. Changed refs, including branch or tag changes with no new commits, create a new snapshot; legacy anchors need a new v2 backup. This behavior requires a CLI built from this source together with the updated server and worker; previously published preview binaries do not include job-aware waiting.

To save an independent recovery file outside the project:

```sh
rivet status --proof-out /private/location/project-recovery.secret.json
```

A waiting backup also accepts `--proof-out`. The file contains the CID, anchor reference and AES-GCM recovery material. It is created exclusively with mode 0600; existing files are never overwritten. Keep it private and outside Git. Regular command output omits recovery keys. On Windows, protect exported files with suitable user filesystem ACLs.

## Restore

With your saved sign-in, restore an existing public backup directly:

```sh
rivet restore owner/repository --target ./recovered.git
```

The default mode is `exact`. Without a name, Rivet detects the current project's GitHub origin; an explicit name works even after the original directory is gone. Without `--target`, the destination is `./repository-restored.git`. Rivet retrieves the latest confirmed recovery proof from your account, independently checks the anchor and bundle, and creates a new **bare mirror**. Existing destinations, including empty directories, are rejected. Original project files are preserved.

Create a working copy from that mirror:

```sh
git clone ./recovered.git ./working-copy
```

To recover without Rivet or a saved sign-in, use an exported recovery file:

```sh
rivet verify --proof /private/location/project-recovery.secret.json
rivet restore --proof /private/location/project-recovery.secret.json --target ./recovered.git
```

You can still specify a transaction hash for `verify` or `owner/repository` for `restore`; the CLI rejects a mismatch with the recovery file. Independent recovery uses the proof, CKB Testnet RPC, IPFS and Git. It does not query the original GitHub repository or read saved login settings. Use `--rpc`, `--gateway`, or `--bundle /path/to/encrypted.bundle` to choose independent sources or recover from a saved file. Bundle size defaults to 512 MiB (`--max-bytes`, at most 2 GiB), including local files.

## Attribution restore

Attribution restore remaps selected author, committer and tagger email addresses. Use a destination email associated with your GitHub account if you intend to push the rewritten history there; GitHub controls contribution-graph eligibility. This mode requires a v2 backup, Python 3 and `git-filter-repo` 2.47.0 (`python -m pip install git-filter-repo==2.47.0`).

Create an owner signing key and an email map outside project version control:

```sh
rivet keygen --out /private/location/owner-key.pem
```

```json
[{ "from": "old@example.com", "to": "new@example.com" }]
```

Save the JSON as `/private/location/emails.json`, then recover:

```sh
rivet restore owner/repository --mode attribution --proof /private/location/recovery.secret.json \
  --email-map /private/location/emails.json --signing-key /private/location/owner-key.pem \
  --target ./attribution-recovery
```

The new destination contains `original.git` (the exact verified mirror), `rewritten.git` and `mapping.json`. Rewriting changes commit IDs and removes original commit/tag signatures in the rewritten copy. Original objects and their signatures remain in `original.git`. Empty commits and merges are retained. Rivet rejects an incomplete mapping, existing destinations and legacy backups; mapping files contain email addresses and should be shared intentionally.

The Ed25519 signature establishes control of the selected key. Establish the owner's public-key fingerprint independently; the embedded key alone does not identify a GitHub user or a wallet. Keep the private key private and give reviewers its `.pub` file through your established identity channel.

```sh
rivet verify-mapping --mapping ./attribution-recovery/mapping.json \
  --owner-key /private/location/owner-key.pem.pub --proof /private/location/recovery.secret.json \
  --target ./attribution-recovery/rewritten.git
```

Verification rechecks the original backup anchor and bundle, reproduces the rewrite, and compares every old/new commit mapping and rewritten ref. It can use `--bundle` to recover from a locally saved encrypted file. The signed mapping is initially unanchored. To anchor it separately, provide your own funded CKB **testnet** private key in a private file containing `0x` plus 64 hex characters:

```sh
rivet anchor-mapping --mapping ./attribution-recovery/mapping.json \
  --owner-key /private/location/owner-key.pem.pub --ckb-key-file /private/location/testnet-key \
  --receipt-out /private/location/mapping-anchor.json
```

This command spends test CKB for a new mapping cell and fee. It saves the signed transaction before broadcasting. After interruption, repeat the same command with the same receipt: it reconciles the saved hash and reuses the same signed bytes. Keep the receipt; do not create a new receipt to work around a pending transaction. The receipt contains signed transaction bytes, without your private key. The command rejects a mainnet RPC.

Use the returned transaction hash to verify the mapping's separate anchor:

```sh
rivet verify-mapping --mapping ./attribution-recovery/mapping.json \
  --owner-key /private/location/owner-key.pem.pub --proof /private/location/recovery.secret.json \
  --target ./attribution-recovery/rewritten.git --anchor 0xYOUR_MAPPING_TRANSACTION --output-index 0
```

## Watch pushed history

```sh
rivet watch ./my-project --interval 30
```

The watcher resolves the project's GitHub origin and polls its pushed refs. It requests an initial snapshot and another backup when remote refs change; unchanged polls do not dispatch new jobs. `--once` checks once. Local-only commits and uncommitted files must be pushed before the hosted worker can include them. The server coalesces concurrent backup requests; the watcher checks again after a coalesced request so a later push is eventually captured. Stop it with Ctrl+C.

## Verification scope

New worker backups use **v2 anchors**, which authenticate the sorted commit set, sorted refs and their object IDs, plaintext Git bundle SHA-256, encrypted IPFS CID, and commit count. Recovery exports use `rivet-backup-proof-v2`. Verification compares every commitment against the confirmed transaction, checks decrypted bytes before running Git, verifies commits and refs, and runs `git fsck`. See the [anchor specification](https://github.com/jedi-dtechmaker/Rivet/blob/cli-v0.1.0-rc.3/docs/BACKUP_ANCHOR_V2.md).

Existing 32-byte legacy anchors and `rivet-backup-proof-v1` files remain supported. They **do not authenticate the CID, bundle SHA-256 or branch/tag refs**. The CLI checks their original ordered commit set, preserves the supplied bundle's refs, and reports that limitation. A new backup is needed to gain v2 commitments; exporting an older backup does not upgrade its anchor.

The CLI trusts the selected RPC for committed status and headers. An anchor proves existence by block height, not truthful Git commit timestamps. Repository names in recovery files are labels; GitHub identity attestation comes separately through the CoTA manifest. IPFS availability and retention are separate from proof validity.

## Development and validation

The [self-test walkthrough](../../docs/CLI_SELF_TEST.md) covers installation, isolated fixture tests and real repository acceptance. The repository's [live acceptance record](../../docs/MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md) includes the verified results and reproduction guide. Rivet does not yet publish a programming SDK.

From the repository root, `pnpm rivet --help` or `node packages/cli/src/cli.mjs --help` runs the same CLI without installation. Run `node --test packages/cli/test/*.test.mjs` for credential handling, project detection, proof tampering and independent recovery. The package smoke test packs an archive, installs it offline into a temporary global prefix, invokes the generated command, and runs saved login, project backup/status and encrypted restore after removing the source project. Network responses use fixtures; no real token or treasury spend is involved.

`pnpm cli:pack` builds the self-contained CKB runtime and npm archive. `node packages/cli/scripts/build-native.mjs` builds the current platform's standalone executable with Node's single-executable facility and pinned `postject`. Release builds run on Linux, macOS and Windows, and publish artifacts only after every build and smoke test succeeds. Local Linux success does not constitute macOS/Windows release acceptance. The repository includes the completed [Milestone 2 plan](../../docs/MILESTONE_TWO_PLAN.md) and platform/live acceptance records.
