# 🛡️ Rivet — Provable Repository of Open & Onchain Files

> **Your code. Your keys. Your rivet. Forever.**

Rivet is a decentralized developer platform that **backs up, timestamps, and restores** your entire GitHub history using blockchain technology. It ensures that no matter what happens — a suspension, a hacked account, a forgotten password — your code, commit history, and rivet of authorship are permanently secured and fully restorable.

---

## 🚨 The Problem

Developers build their careers on platforms they don't control:

- **GitHub can suspend your account overnight** — deleting years of contributions with no appeal
- **Hacked accounts** can lead to permanent loss of commit history and reputation
- **No cryptographic rivet of authorship** — git commits can be forged, timestamps can be faked
- **Your contribution graph and reputation are rented**, not owned — one policy change and it's gone

**Rivet fixes this.** Your code is backed up to decentralized storage, your history is anchored on-chain with immutable timestamps, and if you ever lose access, everything can be restored to a new account — with original dates, commit messages, and full history intact.

---

## ✅ What Rivet Does

| Feature | Description |
|---|---|
| **Backup** | Mirrors your entire GitHub history (every branch, tag, commit) to IPFS/Arweave |
| **Anchor** | Writes a cryptographic rivet (Merkle root) to a CKB Cell — immutable, permanent |
| **View** | Browse your backed-up code on the Rivet web platform — files, commits, history |
| **Restore** | Push everything to a new GitHub account with **original timestamps preserved** |
| **Verify** | Anyone can verify your authorship by checking the on-chain CKB rivet |
| **Own** | Your "Sovereign Passport" is an RGB++ asset — your reputation, owned by you |

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
