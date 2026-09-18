# System Architecture

> This document describes the full system architecture of Rivet. It is the definitive reference for understanding how all components fit together.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [System Layers](#system-layers)
3. [Component Breakdown](#component-breakdown)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Technology Decisions](#technology-decisions)
6. [Security Model](#security-model)
7. [Deployment Architecture](#deployment-architecture)

---

## Architecture Overview

Rivet follows a **layered architecture** with clear separation of concerns:

```
┌───────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                         │
│                                                               │
│  ┌─────────────────────┐    ┌──────────────────────────────┐ │
│  │   Web Platform       │    │   CLI Tool                   │ │
│  │   (Next.js 14)       │    │   (Node.js / TypeScript)     │ │
│  │                      │    │                              │ │
│  │  - Repo browser      │    │  - rivet backup              │ │
│  │  - File viewer       │    │  - rivet restore             │ │
│  │  - Commit history    │    │  - rivet anchor              │ │
│  │  - Public profiles   │    │  - rivet verify              │ │
│  │  - Passport viewer   │    │  - rivet passport            │ │
│  │  - Dashboard         │    │  - rivet status              │ │
│  └──────────┬──────────┘    └──────────────┬───────────────┘ │
└─────────────┼──────────────────────────────┼─────────────────┘
              │                              │
              ▼                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                          │
│                                                               │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │  API Server    │  │  Git Engine   │  │  Timestamp       │ │
│  │  (Fastify)     │  │               │  │  Service         │ │
│  │               │  │  - clone      │  │                  │ │
│  │  - REST API   │  │  - mirror     │  │  - batch commits │ │
│  │  - WebSocket  │  │  - merkle     │  │  - merkle root   │ │
│  │  - Auth       │  │  - diff       │  │  - CKB anchor    │ │
│  │  - Rate limit │  │  - restore    │  │  - verify        │ │
│  └───────┬───────┘  └───────┬───────┘  └────────┬─────────┘ │
│          │                  │                    │            │
│  ┌───────▼──────────────────▼────────────────────▼─────────┐ │
│  │                    Core Library                          │ │
│  │                                                         │ │
│  │  - Repository management                                │ │
│  │  - User/identity management                             │ │
│  │  - Backup orchestration                                 │ │
│  │  - Restore orchestration                                │ │
│  │  - Verification logic                                   │ │
│  └──────────────────────┬──────────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│ STORAGE      │  │ DATABASE     │  │ BLOCKCHAIN       │
│              │  │              │  │                  │
│ IPFS (Helia) │  │ PostgreSQL   │  │ CKB Mainnet     │
│ Arweave      │  │              │  │ RGB++ / Spore   │
│              │  │ - Users      │  │ CCC SDK         │
│ - Git blobs  │  │ - Repos      │  │                  │
│ - Mirrors    │  │ - Backups    │  │ - Timestamp Cells│
│ - Assets     │  │ - Search     │  │ - Passport DOBs │
│              │  │ - Activity   │  │ - Identity Cells │
└──────────────┘  └──────────────┘  └──────────────────┘
```

---

## System Layers

### Layer 1: Presentation

The user-facing interfaces. Two entry points serve different use cases:

**Web Platform (`apps/web/`)**
- Built with **Next.js 14** (App Router) and **React 18**
- Server-side rendering for SEO and performance
- CCC wallet connector for authentication
- Rich code browsing: syntax highlighting, diff views, commit history
- Public profile pages with Sovereign Passport display
- Dashboard for managing backups and repos

**CLI Tool (`apps/cli/`)**
- Built with **TypeScript** + **Commander.js**
- Primary interface for backup/restore operations
- Runs locally — interacts with user's git repos directly
- Communicates with the API server for CKB operations
- Can operate offline for local operations

### Layer 2: Application

The business logic layer. Three main services:

**API Server**
- **Fastify** framework (faster than Express, native TypeScript)
- RESTful endpoints for all platform operations
- WebSocket for real-time updates (backup progress, etc.)
- Authentication via CCC wallet signatures (no passwords)
- Rate limiting and abuse prevention

**Git Engine (`packages/git-engine/`)**
- Wraps `git` operations: clone, mirror, diff, log
- Computes Merkle trees from commit histories
- Handles email remapping for restore operations
- File tree parsing for web-based code browsing

**Timestamp Service**
- Batches commits into Merkle trees
- Submits Merkle roots to CKB as Timestamp Cells
- Manages transaction lifecycle (pending → confirmed)
- Handles verification requests

**Core Library (`packages/core/`)**
- Shared business logic used by both web and CLI
- Repository management (CRUD, metadata)
- User/identity management
- Backup orchestration (coordinate git + IPFS + CKB)
- Restore orchestration (IPFS → local → GitHub)

### Layer 3: Storage

**IPFS (Primary Code Storage)**
- Git mirror archives stored as IPFS objects
- Content-addressable: CID = hash of content
- Pinning service ensures availability (Pinata / web3.storage)
- Used for: git bundles, file blobs, repo archives

**Arweave (Permanent Backup)**
- One-time payment for permanent storage
- Used for critical/released versions
- Insurance layer — even if IPFS pins are lost

**PostgreSQL (Metadata & Index)**
- User accounts and wallet addresses
- Repository metadata (name, description, stats)
- Backup records (CID, Merkle root, CKB tx hash)
- Search index for code discovery
- Activity feeds and notifications

### Layer 4: Blockchain

**CKB (Nervos Common Knowledge Base)**
- Timestamp Cells: Merkle roots of commit histories
- Identity Cells: Wallet-to-profile bindings
- Uses the Cell model (generalized UTXO)
- Provides Bitcoin-level security

**RGB++ (via Spore Protocol)**
- Sovereign Passport: DOB containing developer's full history
- Isomorphically bound to Bitcoin UTXOs
- "Meltable" — CKB capacity reclaimable

**CCC SDK**
- Wallet connectivity (MetaMask, JoyID, UniSat, OKX)
- Transaction composition and signing
- Account abstraction (any ecosystem → CKB address)

**Fiber Network (Future)**
- Payment channels for developer sponsorships
- Micropayments for bounties
- Lightning-compatible

---

## Component Breakdown

### Package: `packages/core/`

The shared business logic library. Framework-agnostic, usable by both web and CLI.

```
packages/core/
├── src/
│   ├── backup/
│   │   ├── backup-orchestrator.ts    # Coordinates full backup flow
│   │   ├── merkle.ts                 # Merkle tree computation
│   │   └── types.ts                  # Backup-related types
│   ├── restore/
│   │   ├── restore-orchestrator.ts   # Coordinates full restore flow
│   │   ├── email-remapper.ts         # git-filter-repo email mapping
│   │   └── types.ts
│   ├── identity/
│   │   ├── identity-manager.ts       # Wallet ↔ profile management
│   │   └── types.ts
│   ├── repo/
│   │   ├── repo-manager.ts           # CRUD operations for repos
│   │   ├── file-tree.ts              # Parse git trees for web display
│   │   └── types.ts
│   └── verification/
│       ├── verifier.ts               # Verify backup against CKB anchor
│       └── types.ts
├── package.json
└── tsconfig.json
```

### Package: `packages/git-engine/`

All git operations, isolated for testability.

```
packages/git-engine/
├── src/
│   ├── clone.ts           # git clone --mirror
│   ├── mirror.ts          # Mirror management (bundle, archive)
│   ├── log.ts             # Commit history parsing
│   ├── diff.ts            # File diffs between commits
│   ├── tree.ts            # File tree at any commit
│   ├── merkle.ts          # Merkle root from commit hashes
│   ├── filter-repo.ts     # Email remapping for restore
│   └── types.ts
├── package.json
└── tsconfig.json
```

### Package: `packages/ckb-client/`

CKB blockchain interactions.

```
packages/ckb-client/
├── src/
│   ├── client.ts               # CKB node connection via CCC
│   ├── timestamp-cell.ts       # Create/read Timestamp Cells
│   ├── passport-dob.ts         # Mint/read Sovereign Passport DOBs
│   ├── identity-cell.ts        # Create/read Identity Cells
│   ├── transaction-builder.ts  # Compose CKB transactions
│   ├── scripts/                # On-chain script definitions
│   │   ├── timestamp-type.ts   # Timestamp Cell type script
│   │   └── passport-type.ts    # Passport DOB type script
│   └── types.ts
├── package.json
└── tsconfig.json
```

### Package: `packages/storage/`

Decentralized storage adapters.

```
packages/storage/
├── src/
│   ├── ipfs/
│   │   ├── client.ts          # IPFS connection (Helia)
│   │   ├── upload.ts          # Upload git bundles to IPFS
│   │   ├── download.ts        # Download from IPFS
│   │   └── pin.ts             # Pinning management
│   ├── arweave/
│   │   ├── client.ts          # Arweave connection
│   │   └── upload.ts          # Upload to Arweave
│   └── types.ts
├── package.json
└── tsconfig.json
```

---

## Data Flow Diagrams

### Flow 1: Backup

```
Developer                 Rivet API              Git Engine         IPFS           CKB
    │                        │                      │                │              │
    │  POST /backup          │                      │                │              │
    │  {github_user, repos}  │                      │                │              │
    │───────────────────────>│                      │                │              │
    │                        │  clone --mirror      │                │              │
    │                        │─────────────────────>│                │              │
    │                        │  mirror archives     │                │              │
    │                        │<─────────────────────│                │              │
    │                        │                      │                │              │
    │                        │  compute merkle root │                │              │
    │                        │─────────────────────>│                │              │
    │                        │  merkle_root         │                │              │
    │                        │<─────────────────────│                │              │
    │                        │                      │                │              │
    │                        │  upload archives     │                │              │
    │                        │──────────────────────────────────────>│              │
    │                        │  IPFS CIDs           │                │              │
    │                        │<─────────────────────────────────────│              │
    │                        │                      │                │              │
    │                        │  create Timestamp Cell│               │              │
    │                        │─────────────────────────────────────────────────────>│
    │                        │  tx_hash             │                │              │
    │                        │<────────────────────────────────────────────────────│
    │                        │                      │                │              │
    │  {merkle_root, cids,   │                      │                │              │
    │   tx_hash, status}     │                      │                │              │
    │<───────────────────────│                      │                │              │
```

### Flow 2: View Code on Platform

```
User (Browser)            Next.js Server           API Server          IPFS
    │                        │                        │                  │
    │  GET /jedi/my-project  │                        │                  │
    │───────────────────────>│                        │                  │
    │                        │  GET /api/repos/{id}   │                  │
    │                        │───────────────────────>│                  │
    │                        │  repo metadata         │                  │
    │                        │<───────────────────────│                  │
    │                        │                        │                  │
    │                        │  GET /api/repos/{id}/  │                  │
    │                        │      tree/main         │                  │
    │                        │───────────────────────>│                  │
    │                        │                        │  fetch git tree  │
    │                        │                        │─────────────────>│
    │                        │                        │  tree data       │
    │                        │                        │<─────────────────│
    │                        │  file tree             │                  │
    │                        │<───────────────────────│                  │
    │                        │                        │                  │
    │  Rendered page with    │                        │                  │
    │  file browser + code   │                        │                  │
    │<───────────────────────│                        │                  │
```

### Flow 3: Restore to New GitHub

```
Developer                 Rivet CLI              IPFS             Git Engine         GitHub
    │                        │                    │                   │                │
    │  rivet restore         │                    │                   │                │
    │  --to new-user         │                    │                   │                │
    │  --email new@email     │                    │                   │                │
    │───────────────────────>│                    │                   │                │
    │                        │  download mirrors  │                   │                │
    │                        │───────────────────>│                   │                │
    │                        │  git bundles       │                   │                │
    │                        │<───────────────────│                   │                │
    │                        │                    │                   │                │
    │                        │  remap emails      │                   │                │
    │                        │──────────────────────────────────────>│                │
    │                        │  remapped repos    │                   │                │
    │                        │<─────────────────────────────────────│                │
    │                        │                    │                   │                │
    │                        │  git push --mirror │                   │                │
    │                        │──────────────────────────────────────────────────────>│
    │                        │  success           │                   │                │
    │                        │<─────────────────────────────────────────────────────│
    │                        │                    │                   │                │
    │  ✅ 47 repos restored  │                    │                   │                │
    │  with original dates   │                    │                   │                │
    │<───────────────────────│                    │                   │                │
```

---

## Technology Decisions

### Why Next.js 14 (not Vite/SPA)?

| Factor | Decision |
|---|---|
| SEO | Public profiles and repos need to be indexable → SSR required |
| Performance | Server components reduce client JS bundle |
| API routes | Backend-for-frontend pattern, reduces CORS complexity |
| Ecosystem | Best React framework for production apps |

### Why Fastify (not Express)?

| Factor | Decision |
|---|---|
| Performance | 2-3x faster than Express in benchmarks |
| TypeScript | Native TypeScript support, schema validation |
| Plugins | Structured plugin system for modular architecture |
| JSON Schema | Built-in request/response validation |

### Why PostgreSQL (not MongoDB)?

| Factor | Decision |
|---|---|
| Relational data | Users, repos, backups have clear relationships |
| Full-text search | Built-in `tsvector` for basic search, MeiliSearch for advanced |
| ACID compliance | Financial-grade consistency for backup records |
| Maturity | Battle-tested, excellent tooling |

### Why IPFS + Arweave (not just one)?

| Factor | Decision |
|---|---|
| IPFS | Fast retrieval, content-addressable, good for frequent access |
| Arweave | Permanent storage, pay once, never worry about pinning |
| Together | IPFS for hot access, Arweave as permanent insurance |

### Why TypeScript everywhere?

| Factor | Decision |
|---|---|
| CCC SDK | Written in TypeScript — native compatibility |
| Monorepo | Shared types across web, CLI, and packages |
| Developer pool | More contributors available than Rust |
| Speed | Faster iteration for MVP phase |

---

## Security Model

### Authentication

- **No passwords.** Users authenticate by signing a challenge message with their wallet (via CCC).
- The signed message proves wallet ownership without transmitting secrets.
- Session tokens (JWT) are issued after signature verification.
- Sessions expire after 24 hours; re-sign to continue.

### Authorization

- Repository access is determined by wallet address ownership.
- Public repos: anyone can read.
- Private repos: only the owner's wallet can access.
- Backup operations require wallet signature for each CKB transaction.

### Data Integrity

- Git mirrors are content-addressable (IPFS CIDs = hash of content).
- Merkle roots on CKB provide tamper-rivet verification.
- Any modification to the backup would change the hash, breaking the on-chain rivet.

### Threat Model

| Threat | Mitigation |
|---|---|
| Platform compromise | Code lives on IPFS/Arweave, rivets live on CKB — platform is just a viewer |
| IPFS pin loss | Arweave permanent backup, multiple pinning services |
| CKB key loss | Standard key backup practices, multi-sig support planned |
| Replay attacks | Nonce-based challenge-response for auth |
| Data manipulation | Merkle rivets verify integrity against on-chain anchors |

---

## Deployment Architecture

### Development (Local)

```
docker-compose up
├── web         (Next.js dev server, port 3000)
├── api         (Fastify dev server, port 4000)
├── postgres    (PostgreSQL, port 5432)
├── ipfs        (Kubo IPFS node, port 5001)
└── ckb         (CKB devnet node, port 8114)
```

### Production

```
┌─────────────────┐     ┌──────────────────┐
│  CDN / Vercel   │────>│  Next.js (SSR)   │
│  (Static + Edge)│     │  (Web Platform)  │
└─────────────────┘     └────────┬─────────┘
                                 │
                        ┌────────▼─────────┐
                        │  API Server      │
                        │  (Fastify)       │
                        │  (Load balanced) │
                        └──┬──────┬──────┬─┘
                           │      │      │
                    ┌──────▼┐  ┌──▼───┐ ┌▼────────┐
                    │Postgres│  │IPFS  │ │CKB Node │
                    │(RDS)   │  │Pins  │ │(Mainnet)│
                    └────────┘  └──────┘ └─────────┘
```
