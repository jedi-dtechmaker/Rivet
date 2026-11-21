# Dependency security fixes

Release CI runs `pnpm audit --audit-level=low` across production and development dependencies. Keep the package manifests, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` together when updating dependencies.

Next.js 15.5.29 fixes the three moderate advisories affecting 15.5.28. The Vercel and Netlify CLIs are updated, and version-scoped overrides select patched releases of their transitive dependencies. Some overrides cross a major version because the older release line has no fix; check the deployment CLIs as well as the application after changing them.

## Legacy CKB SDK patch

JoyID 1.1.4 depends on `@nervosnetwork/ckb-sdk-utils` 0.109.5, whose `elliptic` dependency has no published fix for [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84). The committed pnpm patch replaces its ECPair implementation with `@noble/curves` 2.4.0, already used by CCC. `packageExtensions` supplies Noble to that SDK, and the scoped override removes elliptic from its dependencies.

The patch covers both CommonJS and ES module builds and their declarations. It keeps the CKB digest signing convention (`prehash: false`), canonical low-S signing, DER signatures, and recoverable signatures with the recovery byte appended. Verification continues accepting high-S DER signatures for compatibility. Private keys are validated and copied on construction. The declared public methods keep their hex and public-key array formats; undocumented access to the protected elliptic key object is replaced with a byte array.

`apps/web/tests/sdk-crypto.test.cjs` checks both module builds against Node's signature verifier, ethers' deterministic signatures, known secp256k1 public keys, invalid keys, and mutable key inputs. The existing wallet, proof, backup, and CLI tests cover integration.

When upstream replaces elliptic, remove this patch, its `packageExtensions` entry, and the scoped elliptic override together, then rerun:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level=low
pnpm --filter @rivet/web test
pnpm --filter @rivet/web exec tsc --noEmit --incremental false
pnpm --filter @rivet/web build
node packages/cli/scripts/build-runtime.mjs
node --test packages/cli/test/*.test.mjs
pnpm exec vercel build --help
pnpm exec netlify build --help
```

Run database tests against a disposable PostgreSQL instance with `RIVET_TEST_DATABASE_URL` and `DATABASE_URL` pointing to it. CLI workflow tests also require Git, Python 3, and git-filter-repo 2.47.0. Optional contract tests require their separately configured fixtures.
