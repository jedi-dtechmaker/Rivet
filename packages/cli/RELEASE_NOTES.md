Rivet CLI 0.1.0 is a CKB testnet preview for public GitHub history.

- Install an npm archive or a standalone Linux, macOS or Windows executable. Checksums accompany the artifacts; Git is required.
- Sign in once with a GitHub token, detect the current project's origin, back up pushed history and export a private recovery file.
- Independently verify legacy/v2 proofs and recover an exact mirror after losing the original repository.
- Restore attribution through email remapping, retain an exact original copy, sign a complete commit mapping, reproduce it independently and anchor its digest separately on CKB testnet.
- Watch pushed refs, retry transient reads and reconcile saved signed transaction results after interruptions.

Attribution requires Python 3 and git-filter-repo 2.47.0. Standalone executables include Node; npm installations require Node 24+. macOS binaries use ad-hoc signing and are not notarized; Windows binaries do not have a publisher certificate.

Preview `cli-v0.1.0-rc.3` includes the dependency security fixes from PR #3. Its package/native checks and separate release checks pass on Linux, macOS and Windows. The merged production deployment and additive worker-job schema are live. All public package/executable checksums were independently verified.

Milestone 2 project acceptance completed November 21, 2026 with two live v2 backups, exact recovery of every commit/ref, independently reproduced signed attribution mappings, a confirmed separate mapping anchor, and five negative checks. The public npm CLI passes live recovery, mapping-anchor verification and login/status/logout; the public Linux executable independently verifies the mapping and anchor. The repository contains the final acceptance record and checksummed public evidence directory. Community/reviewer sign-off remains separate.

[CLI installation and usage guide](./README.md), [live acceptance record](../../docs/MILESTONE_TWO_LIVE_ACCEPTANCE_2026-11-21.md), and [remaining Phase Two scope](../../docs/PHASE_TWO_PLAN.md).
