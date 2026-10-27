# Logos RFP Application: Rivet (Decentralised Code Archives)

> **Category**: Decentralised Archives  
> **Initiative**: Permanent, censorship-proof preservation of open-source knowledge, culture, and developer history  
> **Target RFP**: [Logos Builders Hub — Decentralised Archives](https://logos.co/builders-hub/rfps)  
> **Applicant**: Rivet Project Team  
> **Status**: Ready for Submission / One-Pager Format  

---

## 1. Executive Summary

Modern software development relies entirely on centralized platforms like GitHub. Millions of developers and critical open-source software libraries are vulnerable to:
- **Instant deplatforming & account bans** without appeal or recourse.
- **Geopolitical sanctions & unilateral repository takedowns**.
- **Tampered histories and unprovable commit timestamps**.

**Rivet** is a sovereign developer infrastructure that turns Git repositories into **permanent, cryptographically verifiable, and restorable decentralized archives**. Built directly on the **Logos Stack**, Rivet mirrors entire Git repositories to **Codex** for durable storage, anchors commit Merkle roots and sorted branch refs to **Nomos (Logos Blockchain)** via **Zone Channel Inscriptions**, and provides a 1-click **Restore Path** that can resurrect any repo onto a new account or local machine with full commit graphs intact.

---

## 2. Alignment with Logos Principles

| Logos Core Value | Rivet Implementation |
|---|---|
| **Civil Society & Freedom** | Developers own their code and reputation independently of centralized tech monopolies. |
| **Censorship Resistance** | Git mirrors cannot be removed, deindexed, or wiped by corporate platform policies. |
| **Durable Knowledge Preservation** | Code, commit history, and release tags are preserved in perpetuity on Codex with ZK storage auditing. |
| **Tamper-Proof Verification** | Authorship and state transitions are cryptographically anchored on Nomos without trusted third parties. |

---

## 3. Architecture & Technical Integration

Rivet leverages the full Logos stack to eliminate centralized infrastructure:

```
┌────────────────────────────────────────────────────────┐
│                   RIVET ARCHITECTURE                    │
│                                                        │
│   💻 Developer CLI / Web UI (apps/web)                │
│       │                                                │
│       ▼                                                │
│   🔄 Git Engine (Mirror Clone & Bundle Packaging)      │
│       │                                                │
│       ├──► 📦 Codex (Logos Storage):                   │
│       │       Durable, erasure-coded storage of        │
│       │       raw & encrypted git bundles              │
│       │                                                │
│       ├──► ⛓️  Nomos / Zone SDK (Logos Blockchain):    │
│       │       Ed25519 Channel Sequencer anchors:       │
│       │       • Commit Merkle Root                     │
│       │       • Sorted Refs & Tip Commits Hash         │
│       │       • Bundle SHA-256 Checksum                │
│       │       • Codex Content ID (CID)                 │
│       │                                                │
│       └──► 📡 Waku (Logos Messaging):                  │
│               P2P gossip topic for repo push events    │
│               and multi-device indexer sync            │
└────────────────────────────────────────────────────────┘
```

### Key Technical Innovations
1. **Dual Restore Modes (Exact vs. Attribution)**:
   - *Exact Restore*: Byte-for-byte git restoration matching the original commit hashes and timestamps.
   - *Attribution Restore*: For developers whose original GitHub email was lost during a ban, remapping commit author emails to light up their new contribution graph while anchoring a cryptographic Hash Mapping Proof.
2. **Standalone Verification Without Third Parties**:
   - Anyone can verify a restored repository with vanilla `git` and `sha256sum` directly against the Logos on-chain channel inscription—no Rivet servers or GitHub APIs required.
3. **Decentralized Storage via Codex**:
   - Replaces fragile IPFS centralized pinning services with Codex's native erasure coding and proof-of-retrievability protocol.

---

## 4. Scope of Work & Deliverables

### Milestone 1: Codex Storage Adapter & Bundle Archiving (Weeks 1–3)
- [x] Git mirror cloning and bundle packaging engine (`git bundle create --all`).
- [ ] Direct integration with local/remote Codex node API (`/api/codex/v1/data`).
- [ ] Client-side AES-256-GCM encryption for private repositories before Codex upload.
- [ ] Automated verification of bundle SHA-256 checksums post-download.

### Milestone 2: Logos Zone SDK Sequencer & Channel Anchoring (Weeks 4–6)
- [ ] Implementation of a `ZoneSequencer` microservice using the Logos Zone SDK.
- [ ] Automatic Ed25519 Channel creation for each tracked repository.
- [ ] Chained channel inscriptions containing:
  - Repository identifier and metadata.
  - Commit Merkle root (calculated over `git log --all --format=%H`).
  - Sorted ref tips hash (`git show-ref`).
  - Raw bundle SHA-256 hash and Codex CID.
- [ ] Zone Indexer client for tracking repository versions on-chain.

### Milestone 3: Waku P2P Sync & Restore Pipeline (Weeks 7–8)
- [ ] Integration of Waku for peer-to-peer repository update notifications.
- [ ] Automated 1-Click Restore worker pulling from Codex and mirror-pushing to new destinations.
- [ ] Exact Restore and Attribution Restore UI workflows.

### Milestone 4: Logos Basecamp Module & Open Source Release (Weeks 9–10)
- [ ] Packaging Rivet as a runnable module for **Logos Basecamp**.
- [ ] Comprehensive documentation, CLI tool (`rivet-cli`), and end-to-end verification guides.
- [ ] Open-source release under MIT license.

---

## 5. Budget & Milestone Breakdown

| Milestone | Deliverables | Timeline | Funding Requested |
|---|---|---|---|
| **M1: Codex Integration** | Codex adapter, bundle encryption, retrieval tests | 3 Weeks | $10,000 USDC |
| **M2: Zone SDK Anchoring**| Rust `ZoneSequencer`, channel inscriptions, indexer | 3 Weeks | $15,000 USDC |
| **M3: Waku Sync & Restore**| Waku gossip topic, Exact & Attribution restore paths | 2 Weeks | $10,000 USDC |
| **M4: Basecamp & Docs**   | Basecamp packaging, web dashboard, CLI, audit | 2 Weeks | $10,000 USDC |
| **Total**                | **Complete Sovereign Git Archive on Logos** | **10 Weeks** | **$45,000 USDC** |

---

## 6. Team & Prior Art

- **Previous Working Proof of Concept**: Live testnet demo featuring Git bundle mirroring, commit Merkle tree verification, and full dashboard browsing.
- **Skills**: Rust, TypeScript, Node.js, Git internal protocols, distributed systems, cryptographic proof construction.
- **Commitment**: 100% open source, active ecosystem contributor.

---

## 7. Submission Instructions & Next Steps

1. Export this proposal as a 1-page PDF summary or submit via the Logos RFP portal (`logos.co/builders-hub/rfps`).
2. Open an issue/PR on the official Logos RFP repository (`github.com/logos-co/rfps` or `logos-co/builders-hub`).
3. Connect with the Logos developer community on the [Logos Forum](https://forum.logos.co) and Discord.
