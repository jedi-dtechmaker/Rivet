# CCC connector startup fix

`@ckb-ccc/connector@2.2.2` can refresh its signer list before React assigns the CKB client to the server-rendered custom element. JoyID discovery then reads `addressPrefix` on an undefined client and rejects with an uncaught TypeError.

The patch waits for a client before refreshing signers or wrapping the client for fee-rate selection. Subsequent client assignment still triggers discovery normally. Both the package source and distributed JavaScript are patched.

`pnpm-workspace.yaml` registers the patch and `pnpm-lock.yaml` records it, so `pnpm install` reapplies it. After changing this dependency, restart Next.js with a fresh generated cache to avoid testing an old bundled copy.

Verification includes a startup regression test and an actual Chromium page load: the page keeps its GitHub sign-in, the client uses the `ckt` testnet prefix, JoyID appears in the wallet picker, and no uncaught browser exceptions occur. User passkey approval and on-chain CoTA registration still require their separate live acceptance checks.

When upgrading CCC, check whether the upstream initialization race is fixed before removing this patch.
