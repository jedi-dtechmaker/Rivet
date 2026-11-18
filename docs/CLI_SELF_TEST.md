# Test the Rivet CLI yourself

The current package is a CLI. A separately importable Rivet SDK has not been implemented or published. Internal modules under `packages/cli/src` are implementation details, without a supported SDK API.

## Install and check the command

On this Linux workstation, with Node 24+ and Git installed:

```sh
npm install --global /home/jedi/Desktop/CKB/PROOF/dist/rivet-cli-0.1.0.tgz
cd /tmp
rivet --version
rivet --help
```

The version should be `rivet 0.1.0`, and help should list backup, status, verify, restore, watch and attribution commands. Running from `/tmp` checks that the installed command works independently of the Rivet checkout. A standalone executable can be used directly instead and includes Node.

## Run the full local workflow check

Return to the source checkout and ensure Python 3 and git-filter-repo 2.47.0 are on PATH. The official tool is already available under `/tmp/rivet-tools` on this workstation:

```sh
cd /home/jedi/Desktop/CKB/PROOF
node packages/cli/scripts/build-runtime.mjs
PATH="/tmp/rivet-tools:$PATH" node --test packages/cli/test/*.test.mjs
```

Expect 19 passing tests and zero failures. The package smoke test installs the archive into a temporary prefix, invokes the installed command from another project, logs in against a local HTTP fixture, backs up, exports a recovery file, deletes its temporary source repository, restores the exact history, logs out, independently verifies it, performs attribution restore and verifies a saved mapping-anchor receipt. Other tests reject tampered proofs, wrong owner keys, incomplete mappings and existing destinations. Only generated test repositories are deleted; your projects are preserved. These checks use fixtures, without real GitHub credentials or CKB spending.

To run that installed workflow through the Linux native executable:

```sh
PATH="/tmp/rivet-tools:$PATH" \
RIVET_TEST_BINARY="$PWD/dist/rivet-v0.1.0-linux-x64" \
node --test packages/cli/test/package.test.mjs
```

Expect one passing end-to-end test. On another machine, install git-filter-repo 2.47.0 and use that platform's executable path.

## Test a real repository after the server rollout

The hosted Milestone 2 rollout is currently deferred. The default server needs the new account/job routes, additive worker schema and updated worker before this full flow can pass. A missing CLI account route means that server update is pending.

Choose a small public repository that you own, push its commits to GitHub, and sign into the Rivet website with the same account first. Then:

```sh
rivet login
cd /path/to/your-test-repository
rivet backup
rivet status --proof-out /private/location/test-recovery.secret.json
rivet logout
rivet verify --proof /private/location/test-recovery.secret.json
rivet restore --proof /private/location/test-recovery.secret.json --target /new/location/recovered.git
git -C /new/location/recovered.git fsck --full --strict
git clone /new/location/recovered.git /new/location/working-copy
```

Login prompts for a GitHub personal access token without echoing it. The backup should report a confirmed CKB transaction, IPFS CID and block height; verification should return `valid: true`. Compare `git rev-list --all | sort` and `git for-each-ref --format='%(refname) %(objectname)'` in the source and recovered mirror while keeping the source unchanged. Both lists should match for exact restore. Recovering after logout demonstrates that the exported proof does not depend on a saved Rivet login.

Recovery files contain private decryption material: keep them outside version control. Backups include pushed public GitHub history; local-only commits and uncommitted files require pushing first. The [CLI guide](../packages/cli/README.md#attribution-restore) covers manual attribution and mapping-anchor verification. Real backups and mapping anchors spend test CKB and belong to the remaining live acceptance run.
