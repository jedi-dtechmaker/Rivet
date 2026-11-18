Rivet CLI 0.1.0 is a CKB testnet preview for public GitHub history.

- Install an npm archive or a standalone Linux, macOS or Windows executable. Checksums accompany the artifacts; Git is required.
- Sign in once with a GitHub token, detect the current project's origin, back up pushed history and export a private recovery file.
- Independently verify legacy/v2 proofs and recover an exact mirror after losing the original repository.
- Restore attribution through email remapping, retain an exact original copy, sign a complete commit mapping, reproduce it independently and anchor its digest separately on CKB testnet.
- Watch pushed refs, retry transient reads and reconcile saved signed transaction results after interruptions.

Attribution requires Python 3 and git-filter-repo 2.47.0. Standalone executables include Node; npm installations require Node 24+. macOS binaries use ad-hoc signing and are not notarized; Windows binaries do not have a publisher certificate.

The hosted server/worker rollout and live testnet acceptance remain pending. Saved login needs the new `/api/cli/account` route, and the worker changes require the additive worker-job schema and `/api/backup/job`. Read the CLI guide and worker runbook before rollout. This preview does not mark the grant milestone complete.

[CLI installation and usage guide](https://github.com/jedi-dtechmaker/Rivet/blob/cli-v0.1.0-rc.2/packages/cli/README.md).
