# 🛡️ Rivet for Logos — Migration Brief & Preserved Chat History

> **Context Document**: This document preserves the complete architectural analysis, conversation history, and migration roadmap from the original CKB (Nervos) implementation to the **Logos Ecosystem**.
>
> **Project Goal**: Build a decentralized developer platform that backs up, timestamps, and restores entire Git histories on the Logos sovereign technology stack.

---

## 📑 Table of Contents
1. [Original Project Architecture (CKB / Nervos)](#1-original-project-architecture-ckb--nervos)
2. [Preserved Review Feedback & Answers](#2-preserved-review-feedback--answers)
   - Anchoring for the Deletion Case (Sorted Refs & Bundle SHA-256)
   - Cell Lifecycle & State Chaining (UTXO vs Channels)
   - Exact vs. Attribution Restore
3. [Deep Dive into the Logos Ecosystem (`logos.co`)](#3-deep-dive-into-the-logos-ecosystem-logosco)
   - Codex (Logos Storage)
   - Nomos (Logos Blockchain)
   - Logos Zone SDK & Channels
   - Waku (Logos Messaging)
   - Basecamp Runtime
4. [Ecosystem Mapping: CKB ➔ Logos](#4-ecosystem-mapping-ckb--logos)
5. [Grant & Funding Roadmap (Logos RFPs & Lambda Prize)](#5-grant--funding-roadmap-logos-rfps--lambda-prize)
6. [Technical Implementation Roadmap for Logos](#6-technical-implementation-roadmap-for-logos)

---

## 1. Original Project Architecture (CKB / Nervos)

The original project (Rivet / PROOF) was built on **Nervos CKB** with the following stack:
- **Frontend / Dashboard**: Next.js 14 App Router, TypeScript, Vanilla CSS design system.
- **Git Engine**: Mirror cloning (`git clone --mirror`), commit hash enumeration (`git log --all --format=%H`), and bundle packaging (`git bundle create --all`).
- **Off-chain Storage**: Encrypted git bundles (AES-256-GCM) pinned to IPFS via Pinata.
- **On-chain Anchoring**: Cryptographic Merkle root written into a CKB Cell (using `@ckb-ccc/core`).
- **Execution Workers**: GitHub Actions workflow workers (`.github/workflows/backup.yml` and `restore.yml`) running `backup-worker.mjs` and `restore-worker.mjs`.

---

## 2. Preserved Review Feedback & Answers

During review on CKB testnet, the creator of **VeriCell.net** raised two fundamental architectural points:

### Point A: Anchoring for the Deletion Case
> *"If GitHub deletes the repo, the anchor is the only independent reference left. What matters then is: does the restored copy match what was backed up? Anchoring a hash of the sorted refs and their tip commits answers that directly. After restore, anyone can recompute it from the bundle with plain git and compare it to the cell, with no GitHub and no Rivet server involved. Most repos are still SHA-1, so I'd also anchor a SHA-256 of the bundle itself. That lets the copy retrieved from IPFS or Arweave be checked byte for byte before restoring."*

**Analysis & Consensus**:
1. **Sorted Refs + Tip Commits**: The initial implementation only Merkle-hashed commit object IDs (`git log --all --format=%H`). But commit hashes alone don't record branch tips (`refs/heads/main` -> commit X, `refs/tags/v1.0` -> commit Y). Anchoring a deterministic hash of sorted refs (`git show-ref --heads --tags | sort | sha256sum`) enables immediate, zero-dependency validation with plain git.
2. **Bundle SHA-256**: Because git commits are SHA-1 in most repos, and decentralized storage downloads can be tampered with or corrupted, anchoring the `SHA-256` of the `.bundle` allows byte-for-byte pre-restore verification before running git or unbundling.

### Point B: Cell Lifecycle and Cost per Push
> *"With auto-sync on every push, do you consume the previous anchor cell into the new one, or create a fresh cell each time? Consuming and replacing keeps locked capacity flat, and the transaction chain becomes the version history for free. Creating new cells makes the subsidy grow with activity."*

**Analysis & Consensus**:
- In the CKB codebase (`apps/web/scripts/backup-worker.mjs` and `apps/web/prisma/schema.prisma`), Rivet **already implemented the cell consumption model**.
- `ckbCellOutpoint` (`0x<txHash>:<index>`) is stored in the database. On every subsequent push, the previous cell is passed as transaction input (`previousOutput`) and spent into a replacement cell of the exact same capacity (~93 CKB).
- This keeps storage rent flat for life, while the UTXO input/output transaction chain acts as the tamper-proof version history.

### Point C: Exact vs. Attribution Restore Modes
- **Exact Restore**: Restores the bundle byte-for-byte with identical commit hashes, author emails, and timestamps via `git push --mirror`.
- **Attribution Restore**: When a developer loses their GitHub account / primary email, GitHub won't attribute commits to their new account unless author/committer emails match. Attribution mode remaps emails using `git-filter-repo` so their green contribution graph lights up on their new account, while anchoring a "Hash Mapping Proof" linking back to the original root.

---

## 3. Deep Dive into the Logos Ecosystem (`logos.co`)

Logos (`https://logos.co/get-started`, `https://docs.logos.co/`) is a comprehensive, privacy-first sovereign technology stack designed for decentralized civil society and parallel institutions.

### 1. Logos Blockchain (Nomos)
- A private, sovereign Layer 1 network built for trustless coordination and consensus.
- Employs zero-knowledge proofs (ZK), mix-nets for network-layer anonymity, and a modular service architecture.

### 2. Logos Storage (Codex)
- Built for censorship-resistant, durable decentralized storage.
- Uses **erasure coding** and lightweight **ZK remote auditing** (proof of retrievability).
- Unlike IPFS (which relies on centralized pinning services like Pinata), Codex guarantees data availability natively in the protocol.

### 3. Logos Messaging (Waku)
- Decentralized, privacy-preserving peer-to-peer communication protocol.
- Perfect for p2p git synchronization, gossiping repository updates, and private push notifications.

### 4. Logos Zone SDK & Channels
- **Zones**: Execution environments built on the Logos Blockchain that post state updates as on-chain inscriptions via **Channels**.
- **Channel ID**: Defined by an Ed25519 public key. The private key acts as the authorized signing key.
- **Sequencer (`ZoneSequencer`)**: Batches transactions, signs them, and publishes inscriptions to the channel.
- **Indexer (`ZoneIndexer`)**: Follows channel inscriptions on-chain and reconstructs application state locally (e.g., SQLite/PostgreSQL).

---

## 4. Ecosystem Mapping: CKB ➔ Logos

| Component | CKB (Nervos) Implementation | Logos Implementation |
|---|---|---|
| **Git History Storage** | IPFS (Pinata) + AES-256 encryption | **Codex** (Logos Storage with erasure coding & retrievability proofs) |
| **Commit Root Anchoring** | CKB Cell (UTXO model, flat ~93 CKB capacity) | **Logos Blockchain (Nomos)** via **Channel Inscriptions** |
| **State Chaining** | Spending `previousOutput` UTXO into new Cell | Channel sequential parent hash references (`SequencerCheckpoint`) |
| **Event / Notification Relay** | Centralized webhooks & REST API callbacks | **Waku** (P2P gossip network for repository sync signals) |
| **Developer Identity** | RGB++ Spore DOBs (bound to Bitcoin UTXOs) | **Logos Sovereign Credentials** & Ed25519 Channel Keys |
| **App Shell** | Next.js Web App | Next.js Web App + **Logos Basecamp** / LEZ module |

---

## 5. Grant & Funding Roadmap (Logos RFPs & Lambda Prize)

Logos actively funds applications that align with decentralized sovereignty.

### 🎯 Primary Opportunity: "Decentralised Archives" RFP
On the Logos Builders Hub (`https://logos.co/builders-hub/rfps`), there is an active RFP:
- **Title**: *Decentralised Archives*
- **Focus**: Permanent, censorship-proof preservation of knowledge, culture, and history.
- **Fit**: Rivet matches this RFP directly—preserving open-source software, commit history, and cryptographic authorship against platform censorship (e.g. GitHub account deactivations).

### 🏆 Secondary Opportunity: The Lambda Prize (`λPrize`)
- Program at `https://logos.co/lambda-prize`.
- Targets competitive solutions where Logos rewards high-impact sovereign tools.

---

## 6. Technical Implementation Roadmap for Logos

### Step 1: Codex Storage Adapter
- Replace `PinataSDK` in `apps/web/scripts/backup-worker.mjs` and `restore-worker.mjs` with a **Codex Storage Client**.
- The git `.bundle` file will be stored directly on Codex nodes, obtaining a Codex content CID with automated proof of storage.

### Step 2: Logos Zone Sequencer for Anchoring
- Create a lightweight Rust microservice using the **Logos Zone SDK** (`ZoneSequencer`):
  ```rust
  // Each repository maps to a dedicated Channel ID (Ed25519 public key)
  // When a backup finishes, post an inscription with:
  struct RepoAnchor {
      version: u8,
      bundle_sha256: [u8; 32],
      sorted_refs_hash: [u8; 32],
      merkle_root: [u8; 32],
      codex_cid: String,
      timestamp: u64,
  }
  ```
- Sequencer posts this inscription to the repo's channel on the Logos Blockchain.

### Step 3: P2P Git Sync via Waku
- Replace GitHub webhooks with a Waku topic (e.g. `/rivet/1.0.0/repo-sync/proto`).
- When a developer pushes locally, a lightweight git hook notifies the repository's channel via Waku.

### Step 4: Web Viewer & Basecamp Packaging
- Keep the existing Next.js web dashboard (`apps/web`) for repo browsing, commit viewing, and 1-click restore.
- Package as a module for **Logos Basecamp** so users can run their git backup vault locally or headlessly.
