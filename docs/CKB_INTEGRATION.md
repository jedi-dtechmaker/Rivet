# CKB, RGB++, CCC & Fiber Integration Guide

> This document explains exactly how Rivet uses each Nervos ecosystem technology, with code examples and transaction structures.

---

## Table of Contents

1. [Technology Overview](#technology-overview)
2. [CCC — Wallet Connectivity & SDK](#ccc--wallet-connectivity--sdk)
3. [CKB — Timestamp Cells](#ckb--timestamp-cells)
4. [RGB++ & Spore — Sovereign Passport DOBs](#rgb--spore--sovereign-passport-dobs)
5. [Fiber — Payment Channels (Future)](#fiber--payment-channels-future)
6. [Transaction Cost Estimates](#transaction-cost-estimates)
7. [Testnet vs Mainnet Strategy](#testnet-vs-mainnet-strategy)

---

## Technology Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Rivet's Blockchain Stack                 │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌─────────┐ │
│  │    CCC     │  │    CKB     │  │  RGB++   │  │  Fiber  │ │
│  │            │  │            │  │  + Spore │  │         │ │
│  │  Wallet    │  │  Timestamp │  │          │  │ Payment │ │
│  │  Connect   │  │  Anchor    │  │ Passport │  │ Channel │ │
│  │  + SDK     │  │  Layer     │  │ Minting  │  │ (Later) │ │
│  │            │  │            │  │          │  │         │ │
│  │  Phase 1   │  │  Phase 2   │  │ Phase 3  │  │ Phase 6 │ │
│  └────────────┘  └────────────┘  └──────────┘  └─────────┘ │
└──────────────────────────────────────────────────────────────┘
```

| Technology | Role in Rivet | When Used |
|---|---|---|
| **CCC** | Wallet connectivity, transaction building, account abstraction | Phase 1+ (auth from day 1) |
| **CKB** | Permanent storage of Merkle roots as Timestamp Cells | Phase 2+ (anchoring) |
| **RGB++/Spore** | Sovereign Passport DOBs — developer identity assets | Phase 3+ (passport minting) |
| **Fiber** | Lightning-compatible payment channels for bounties/sponsorships | Phase 6+ (future) |

---

## CCC — Wallet Connectivity & SDK

### What CCC Does for Rivet

CCC (Common Chains Connector) is our **primary SDK** for all CKB interactions. It handles:

1. **Wallet Connection** — Users authenticate by connecting their wallet (MetaMask, JoyID, UniSat, OKX)
2. **Transaction Composition** — Building CKB transactions to create Cells
3. **Signing** — Users sign transactions with their wallet
4. **Account Abstraction** — EVM/BTC users get CKB addresses automatically

### NPM Packages

```json
{
  "dependencies": {
    "@ckb-ccc/core": "latest",
    "@ckb-ccc/connector-react": "latest",
    "@ckb-ccc/rgbpp": "latest"
  }
}
```

### Authentication Flow

```
User clicks "Connect Wallet"
        │
        ▼
┌─────────────────────────────────┐
│  CCC Wallet Selection Modal     │
│                                 │
│  🦊 MetaMask                   │
│  🔑 JoyID (Passkey)            │
│  ₿  UniSat (Bitcoin)           │
│  📱 OKX Wallet                 │
└─────────────────┬───────────────┘
                  │
                  ▼
User selects wallet & approves connection
                  │
                  ▼
CCC returns CKB address (derived via account abstraction)
                  │
                  ▼
Rivet API issues challenge: "Sign this message: rivet-auth-{nonce}"
                  │
                  ▼
User signs with wallet → signature sent to API
                  │
                  ▼
API verifies signature → issues JWT session token
                  │
                  ▼
User is authenticated. CKB address = their identity.
```

### Code Example: Wallet Connection (React)

```tsx
// apps/web/components/WalletConnect.tsx
import { ccc } from "@ckb-ccc/connector-react";

export function WalletConnect() {
  const { open, wallet, address } = ccc.useWallet();

  const handleConnect = async () => {
    // Opens CCC's built-in wallet selection modal
    // Supports MetaMask, JoyID, UniSat, OKX
    await open();
  };

  if (wallet) {
    return <div>Connected: {address}</div>;
  }

  return <button onClick={handleConnect}>Connect Wallet</button>;
}
```

### Code Example: Signing a Message (Auth)

```typescript
// packages/core/src/identity/auth.ts
import { ccc } from "@ckb-ccc/core";

export async function signAuthChallenge(
  client: ccc.Client,
  signer: ccc.Signer,
  nonce: string
): Promise<string> {
  const message = `rivet-auth-${nonce}`;
  const signature = await signer.signMessage(message);
  return signature;
}

export async function verifyAuthSignature(
  client: ccc.Client,
  address: string,
  nonce: string,
  signature: string
): Promise<boolean> {
  const message = `rivet-auth-${nonce}`;
  // CCC handles verification across all wallet types
  return ccc.verifyMessage(address, message, signature);
}
```

---

## CKB — Timestamp Cells

### What Gets Stored On-Chain

Rivet creates **Timestamp Cells** on CKB. Each Cell contains:

```
┌─────────────────────────────────────────────────────────┐
│  TIMESTAMP CELL                                         │
│                                                         │
│  capacity: 200-500 CKBytes                              │
│                                                         │
│  data: {                                                │
│    version:      1                                      │
│    type:         "rivet-timestamp/v1"                   │
│    owner:        "ckb1q...abc"                          │
│    merkle_root:  "0x7a8b3c..."  (32 bytes)             │
│    repo_count:   47                                     │
│    commit_count: 3241                                   │
│    ipfs_cid:     "bafybeig..."                         │
│    created_at:   1726678590                             │
│  }                                                      │
│                                                         │
│  lock: <owner's lock script>                            │
│  type: <RivetTimestampTypeScript>                       │
└─────────────────────────────────────────────────────────┘
```

### How Merkle Roots Are Computed

```
                    Merkle Root
                   (stored on CKB)
                        │
                ┌───────┴───────┐
                │               │
            Hash(A+B)       Hash(C+D)
            │       │       │       │
          Hash A  Hash B  Hash C  Hash D
            │       │       │       │
         Repo 1  Repo 2  Repo 3  Repo 4
            │       │       │       │
     [commit  [commit  [commit  [commit
      hashes]  hashes]  hashes]  hashes]
```

Each repository's commit hashes are hashed into a per-repo Merkle root, and then all repo roots are combined into a single master Merkle root. This means:

- **1 CKB Cell** proves the integrity of **ALL** repos
- Individual repos can be verified with a **Merkle rivet** (without revealing other repos)
- Cost-efficient: ~200 CKB per backup regardless of number of repos

### Code Example: Creating a Timestamp Cell

```typescript
// packages/ckb-client/src/timestamp-cell.ts
import { ccc } from "@ckb-ccc/core";

export interface TimestampData {
  version: number;
  merkleRoot: string;     // 32-byte hex
  repoCount: number;
  commitCount: number;
  ipfsCid: string;
  createdAt: number;      // Unix timestamp
}

export async function createTimestampCell(
  client: ccc.Client,
  signer: ccc.Signer,
  data: TimestampData
): Promise<string> {
  // Serialize the timestamp data
  const cellData = serializeTimestampData(data);

  // Build the transaction
  const tx = ccc.Transaction.from({
    outputs: [
      {
        lock: await signer.getRecommendedAddressObj(),
        type: Rivet_TIMESTAMP_TYPE_SCRIPT,
      },
    ],
    outputsData: [cellData],
  });

  // Auto-fill capacity and inputs
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000); // fee rate

  // Sign and send
  const txHash = await signer.sendTransaction(tx);
  return txHash;
}
```

### Verification

```typescript
// packages/core/src/verification/verifier.ts
export async function verifyBackup(
  client: ccc.Client,
  txHash: string,
  repos: Repository[]
): Promise<VerificationResult> {
  // 1. Fetch the Timestamp Cell from CKB
  const cell = await fetchTimestampCell(client, txHash);
  const onChainMerkleRoot = cell.data.merkleRoot;

  // 2. Recompute the Merkle root from the repos
  const computedMerkleRoot = computeMerkleRoot(repos);

  // 3. Compare
  const isValid = onChainMerkleRoot === computedMerkleRoot;

  return {
    isValid,
    onChainMerkleRoot,
    computedMerkleRoot,
    timestamp: cell.data.createdAt,
    txHash,
    blockNumber: cell.blockNumber,
  };
}
```

---

## RGB++ & Spore — Sovereign Passport DOBs

### What is the Sovereign Passport?

The Sovereign Passport is an **RGB++ Spore DOB (Digital Object)** that represents a developer's entire coding identity:

```
┌──────────────────────────────────────────────────────────────┐
│  SOVEREIGN PASSPORT (Spore DOB / RGB++ Asset)               │
│                                                              │
│  Content-Type: application/json                              │
│                                                              │
│  Content: {                                                  │
│    schema: "sovereign-passport/v1",                          │
│    identity: {                                               │
│      ckb_address: "ckb1q...abc",                            │
│      display_name: "jedi",                                   │
│      github_username_hash: "sha256('jedi')",                │
│      created_at: 1726678590                                  │
│    },                                                        │
│    stats: {                                                  │
│      total_repos: 47,                                        │
│      total_commits: 3241,                                    │
│      first_commit_date: "2019-03-15T10:30:00Z",            │
│      last_backup_date: "2026-09-18T16:00:00Z",             │
│      languages: ["TypeScript", "Rust", "Python"]             │
│    },                                                        │
│    backups: [                                                │
│      {                                                       │
│        timestamp_tx: "0xabc...",                             │
│        merkle_root: "0x7a8b3c...",                          │
│        ipfs_cid: "bafybeig...",                             │
│        repo_count: 47,                                       │
│        date: "2026-09-18T16:00:00Z"                         │
│      }                                                       │
│    ],                                                        │
│    signature: "0x..."                                        │
│  }                                                           │
│                                                              │
│  lock: <owner's CKB lock>                                   │
│  type: <SporeTypeScript>                                     │
│  capacity: ~500 CKB                                          │
└──────────────────────────────────────────────────────────────┘
```

### Why RGB++ (not just a plain CKB Cell)?

| Feature | Plain CKB Cell | RGB++ Spore DOB |
|---|---|---|
| **Bitcoin binding** | ❌ | ✅ Isomorphically bound to Bitcoin UTXO |
| **Security** | CKB-level | Bitcoin + CKB level |
| **Visual rendering** | ❌ Raw data | ✅ Renderable as a profile card |
| **Composability** | Manual | ✅ Spore protocol standard |
| **"Meltable"** | Manual | ✅ Destroy DOB → reclaim CKB capacity |
| **Ecosystem** | Custom | ✅ Works with Spore explorers, wallets |

### Code Example: Minting a Sovereign Passport

```typescript
// packages/ckb-client/src/passport-dob.ts
import { ccc } from "@ckb-ccc/core";

export interface PassportContent {
  identity: {
    ckbAddress: string;
    displayName: string;
    githubUsernameHash: string;
    createdAt: number;
  };
  stats: {
    totalRepos: number;
    totalCommits: number;
    firstCommitDate: string;
    lastBackupDate: string;
    languages: string[];
  };
  backups: BackupRecord[];
}

export async function mintSovereignPassport(
  client: ccc.Client,
  signer: ccc.Signer,
  content: PassportContent
): Promise<string> {
  // Create Spore DOB with passport content
  const sporeData = {
    contentType: "application/json",
    content: Buffer.from(JSON.stringify(content)),
    // Cluster ID for Rivet passports (optional grouping)
    clusterId: Rivet_PASSPORT_CLUSTER_ID,
  };

  // Build Spore creation transaction
  const { tx, outputIndex } = await createSpore(client, signer, sporeData);

  // Sign and send
  const txHash = await signer.sendTransaction(tx);

  return txHash;
}
```

---

## Fiber — Payment Channels (Future)

### Planned Use Cases

Fiber Network is a CKB-based payment channel network (similar to Bitcoin's Lightning Network). Rivet will use it for:

| Use Case | Description | Phase |
|---|---|---|
| **Sponsorships** | Anyone can sponsor a verified developer via their public profile | Phase 6 |
| **Bounties** | Project owners post bounties → contributor solves → instant payment | Phase 6 |
| **Storage payments** | Pay for IPFS pinning/Arweave storage via micro-payments | Phase 6 |
| **Premium features** | Pay-per-use for private repo backups | Phase 6 |

### Integration Architecture (Future)

```
Developer A                   Fiber Network                Developer B
(Sponsor)                     (Payment Channel)            (Recipient)
    │                              │                           │
    │  "Sponsor jedi 10 CKB/mo"   │                           │
    │─────────────────────────────>│                           │
    │                              │  Route payment            │
    │                              │──────────────────────────>│
    │                              │                           │
    │  Instant, off-chain,         │  Verified via Sovereign  │
    │  near-zero fees              │  Passport on CKB         │
    │                              │                           │
```

> **Note**: Fiber integration is deferred to Phase 6. The focus now is on the core backup/anchor/restore flow.

---

## Transaction Cost Estimates

### CKB Cell Economics

CKB uses a unique "storage rent" model:
- **1 CKByte = 1 byte of on-chain storage**
- You "lock" CKB as capacity to store data
- When you no longer need the Cell, you can "destroy" it and reclaim the CKB

### Cost Breakdown for Rivet

| Operation | Data Size | CKB Required | USD Estimate* |
|---|---|---|---|
| **Timestamp Cell** (1 backup) | ~200 bytes | ~200 CKB | ~$1.00 |
| **Sovereign Passport DOB** | ~500 bytes | ~500 CKB | ~$2.50 |
| **Identity Cell** | ~100 bytes | ~100 CKB | ~$0.50 |
| **Transaction fee** | — | ~0.001 CKB | ~$0.00 |
| **Total (first backup + passport)** | — | **~800 CKB** | **~$4.00** |

*Estimated at 1 CKB ≈ $0.005. Actual price varies.

### Cost Optimization Strategies

1. **Batch backups** — One Merkle root covers ALL repos (not one Cell per repo)
2. **Updatable Cells** — Update existing Timestamp Cell instead of creating new ones
3. **Selective anchoring** — Only anchor on major backups, not every commit
4. **"Meltable" passport** — If user wants to leave, they can reclaim CKB capacity

---

## Testnet vs Mainnet Strategy

### Development Phases

| Phase | Network | Purpose |
|---|---|---|
| **Development** | CKB Devnet (local) | Fast iteration, free CKB, reset anytime |
| **Staging** | CKB Testnet (Pudge) | Integration testing with real network conditions |
| **Production** | CKB Mainnet (Mirana) | Real anchoring, real passports |

### Testnet Faucet

For testnet development, obtain free CKB from:
- CKB Testnet Faucet: `https://faucet.nervos.org/`
- Approximately 10,000 CKB per request

### Network Configuration

```typescript
// packages/ckb-client/src/config.ts
export const CKB_NETWORKS = {
  devnet: {
    url: "http://localhost:8114",
    indexerUrl: "http://localhost:8116",
  },
  testnet: {
    url: "https://testnet.ckbapp.dev",
    indexerUrl: "https://testnet.ckbapp.dev/indexer",
  },
  mainnet: {
    url: "https://mainnet.ckbapp.dev",
    indexerUrl: "https://mainnet.ckbapp.dev/indexer",
  },
} as const;
```
