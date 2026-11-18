# 🛡️ Rivet — Provable Repository of Open & Onchain Files

> **Your code. Your keys. Your rivet. Forever.**

Rivet backs up public GitHub repository history to encrypted IPFS bundles, anchors its commitments on CKB testnet, and restores verified Git mirrors. Export a private recovery file to recover independently of GitHub and Rivet.

---

## 🚨 The Problem

Developers build their careers on platforms they don't control:

- **GitHub can suspend your account overnight** — deleting years of contributions with no appeal
- **Hacked accounts** can lead to permanent loss of commit history and reputation
- **No cryptographic rivet of authorship** — git commits can be forged, timestamps can be faked
- **Your contribution graph and reputation are rented**, not owned — one policy change and it's gone

Rivet anchors repository state by a CKB block height. Exact restore preserves the stored commit IDs, dates and messages; the anchor does not certify commit dates or authorship. IPFS availability depends on retaining and serving the bundle. Local-only commits and working files are outside the hosted backup scope.

---

## ✅ What Rivet Does

| Feature | Description |
|---|---|
| **Backup** | Mirrors pushed public GitHub history, including branches and tags, to encrypted IPFS bundles |
| **Anchor** | Commits repository state in a CKB transaction; later backups consume and replace the repository's anchor cell |
| **View** | Browse your backed-up code on the Rivet web platform — files, commits, history |
| **Restore** | Push everything to a new GitHub account with **original timestamps preserved** |
| **Verify** | Independently check repository commitments against CKB; developer identity has a separate optional CoTA proof |
| **Own** | Mint an optional JoyID-owned Spore passport on testnet |

---

## 🏛️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      USER INTERFACES                        │
│                                                             │
│   🌐 Web Platform (rivet.dev)    💻 CLI (rivet-cli)        │
│   Browse repos, view code,       Backup, restore,           │
│   manage backups, profile        anchor, verify              │
└─────────────────┬───────────────────────┬───────────────────┘
                  │                       │
┌─────────────────▼───────────────────────▼───────────────────┐
│                    APPLICATION LAYER                         │
│                                                             │
│   🔐 Auth (CCC Wallet Connect)                              │
│   📡 API Server (REST + WebSocket)                           │
│   🔄 Git Protocol Handler                                    │
│   ⏱️  Timestamp Service                                      │
└─────────────────┬───────────────────────┬───────────────────┘
                  │                       │
┌─────────────────▼──────────┐ ┌──────────▼──────────────────┐
│      STORAGE LAYER         │ │     BLOCKCHAIN LAYER        │
│                            │ │                              │
│  📦 IPFS (git mirrors)    │ │  ⛓️  CKB (timestamp cells)  │
│  🏛️ Arweave (permanent)  │ │  🎨 RGB++ (passport DOBs)   │
│  🗄️ PostgreSQL (index)   │ │  🔗 CCC (wallet SDK)        │
│                            │ │  ⚡ Fiber (payments, later) │
└────────────────────────────┘ └──────────────────────────────┘
```

→ Full architecture details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## 🧱 Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 + React 18 | Web platform UI |
| Backend | Node.js + Fastify | API server |
| Database | PostgreSQL | Metadata, search index |
| Git Engine | `isomorphic-git` + `git clone --mirror` | Repo operations |
| Blockchain SDK | `@ckb-ccc/core`, `@ckb-ccc/connector-react` | CKB transactions, wallet auth |
| RGB++ Assets | `@ckb-ccc/rgbpp` + Spore Protocol | Sovereign Passport DOBs |
| Code Storage | IPFS (Helia) + Arweave | Decentralized git mirrors |
| Search | MeiliSearch | Full-text code search |
| Containerization | Docker + Docker Compose | Deployment |

---

## 📁 Project Structure

```
Rivet/
├── README.md                  ← You are here
├── CONTRIBUTING.md            ← How to contribute
├── LICENSE                    ← MIT License
│
├── docs/                      ← All project documentation
│   ├── ARCHITECTURE.md        ← System architecture & design decisions
│   ├── PHASES.md              ← Development phases & roadmap
│   ├── CKB_INTEGRATION.md    ← CKB, RGB++, CCC, Fiber integration guide
│   ├── DATA_MODELS.md        ← On-chain cells, database schemas, data flow
│   ├── USER_FLOWS.md         ← User journeys & interaction flows
│   └── API_SPEC.md           ← REST API specification
│
├── apps/
│   ├── web/                   ← Next.js web platform (Phase 1)
│   └── cli/                   ← CLI tool (Phase 2)
│
├── packages/
│   ├── core/                  ← Shared business logic
│   ├── git-engine/            ← Git operations (mirror, restore, merkle)
│   ├── ckb-client/            ← CKB/RGB++ transaction builders
│   └── storage/               ← IPFS/Arweave storage adapters
│
└── docker/                    ← Docker configs for local dev & deployment
```

---

## 🗺️ Roadmap

| Phase | Name | Focus | Status |
|---|---|---|---|
| 1 | **Foundation** | Web UI + CCC auth + repo viewer | 🏗️ In Progress |
| 2 | **Backup Engine** | Git mirroring + IPFS storage + CKB anchoring | ⏳ Planned |
| 3 | **Sovereign Passport** | RGB++ DOB minting + public profiles | ⏳ Planned |
| 4 | **Restore** | Push to new GitHub + email remapping + verification | ⏳ Planned |
| 5 | **Social Features** | Stars, forks, search, notifications | ⏳ Planned |
| 6 | **Platform** | Full GitHub alternative with PRs, issues, CI/CD | 🔮 Future |

→ Full phase details: [docs/PHASES.md](docs/PHASES.md)

---

## 🔗 Documentation Index

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, component design, technology choices |
| [PHASES.md](docs/PHASES.md) | Detailed development phases with milestones and deliverables |
| [CKB_INTEGRATION.md](docs/CKB_INTEGRATION.md) | How CKB, RGB++, CCC, and Fiber are integrated |
| [DATA_MODELS.md](docs/DATA_MODELS.md) | On-chain Cell structures, database schemas, data flow |
| [USER_FLOWS.md](docs/USER_FLOWS.md) | Step-by-step user journeys for every feature |
| [API_SPEC.md](docs/API_SPEC.md) | REST API endpoints specification |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

---

## 🤝 Core Principles

1. **Developers own their code** — Not platforms, not corporations. You.
2. **Timestamps are sacred** — Every commit date is preserved, always.
3. **Rivet is permanent** — CKB anchors can't be deleted, edited, or censored.
4. **Works WITH GitHub** — We're not asking you to leave. We're giving you insurance.
5. **Open source, always** — Rivet itself is open source. No vendor lock-in, ever.

---

## License

MIT — See [LICENSE](LICENSE)
