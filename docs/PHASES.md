# Development Phases & Roadmap

> This document breaks down Rivet into actionable phases with clear milestones, deliverables, and acceptance criteria. It reflects the CoTA-driven, frictionless Web2.5 onboarding architecture.

---

## Phase Overview

```
Phase 1          Phase 2           Phase 3            Phase 4           Phase 5          Phase 6
Foundation       Backup Engine     Sovereign          Restore           Social           Full
                                   Passport                             Features         Platform
                                   
[Web UI]         [Git Mirror]      [RGB++ DOB]        [Restore CLI]    [Stars/Forks]    [PRs/Issues]
[GitHub Auth]    [IPFS Upload]     [Passport Mint]    [Exact Restore]  [Search]         [CI/CD]
[Repo Viewer]    [CoTA SMT]        [Public Profile]   [Attrib Restore] [Notifications]  [Packages]
[Dashboard]      [Background Key]  [Verify Page]      [Hash Mapping]   [Orgs/Teams]     [API]

── Weeks 1-4 ──  ── Weeks 5-8 ──  ── Weeks 9-12 ──  ── Weeks 13-16 ── ── Weeks 17+ ── ── Future ──
```

---

## Phase 1: Foundation (Weeks 1-4)

> **Goal**: A working web platform where users can log in frictionlessly via GitHub and browse their repositories with full code viewing and commit history.

### Why This Phase First

- Gives users something **visible and tangible** immediately.
- Establishes the **GitHub-first authentication pattern** (zero Web3 friction).
- Creates the **data models** and **API patterns** everything else builds on.

### Deliverables

- [ ] **Monorepo setup** — pnpm workspaces, TypeScript config, ESLint, Prettier
- [ ] **Next.js app** — App Router, layout system, dark theme, design system
- [ ] **Landing page** — Hero section explaining Rivet, call-to-action
- [ ] **GitHub OAuth integration** — Primary sign-up and login mechanism
- [ ] **Database schema v1** — Users (GitHub-keyed), repositories, backups tables
- [ ] **Repository list page** — Grid/list of user's repos with metadata
- [ ] **Repository detail page** — File tree browser, click to view files
- [ ] **File viewer** — Syntax-highlighted code display (Shiki or Prism)
- [ ] **Commit history page** — Scrollable list of commits with dates, messages, authors
- [ ] **Dashboard** — Overview of user's repos, backup status, account health

### Acceptance Criteria

- [ ] User can log in with just their GitHub account (OAuth).
- [ ] User sees a list of their GitHub repos on the dashboard.
- [ ] User can browse files in any repo with syntax highlighting.
- [ ] User can view full commit history with original dates.
- [ ] All pages are responsive (mobile + desktop) and dark mode by default.

---

## Phase 2: Backup Engine (Weeks 5-8)

> **Goal**: Users can back up their GitHub repositories to IPFS. Rivet handles the Web3 complexity in the background by silently generating a wallet, creating a CoTA cell, and subsidizing the CKB anchoring costs.

### Deliverables

- [ ] **Git mirror service** — `git clone --mirror` for each repository
- [ ] **IPFS upload** — Upload git bundles to IPFS via Helia
- [ ] **Background Key Generation** — Silently generate a JoyID/WebAuthn account in the backend upon first backup.
- [ ] **CoTA SMT initialization** — Subsidize ~150 CKB to create the user's CoTA cell.
- [ ] **Merkle tree computation** — Build tree from commit hashes.
- [ ] **CoTA Anchor Layer** — Write the compressed Merkle root to the CoTA Sparse Merkle Tree (SMT).
- [ ] **Anchor Productionization** — Use custom Type Scripts and unspendable locks to guarantee immutability.
- [ ] **Timestamp Accuracy Update** — UI clarifies that Rivet proves existence *by a CKB block height*, not the raw git commit time.

### Acceptance Criteria

- [ ] User clicks "Backup" and the process completes without them needing a crypto wallet.
- [ ] A background JoyID account is generated and the 150 CKB subsidy is applied.
- [ ] Merkle root is compressed via CoTA SMT and anchored to CKB Testnet (Aggron).
- [ ] Backup can be triggered for all repos at once.

---

## Phase 3: Sovereign Passport (Weeks 9-12)

> **Goal**: Power users can optionally upgrade their account to take full non-custodial ownership of their data. The platform mints milestone-based Sovereign Passports.

### Deliverables

- [ ] **Optional Upgrade Flow** — Allow users to pay 150 CKB to take full non-custodial control of their CoTA cell via their own CCC wallet.
- [ ] **Spore DOB Design** — Define the Sovereign Passport data schema, bound to a Bitcoin UTXO.
- [ ] **Milestone Versioning** — Mint a *new* passport version for major milestones instead of mutating an existing DOB.
- [ ] **Public profile page** — `rivet.dev/{username}` showing Passport summary, repo list, and contribution timeline.
- [ ] **Verification endpoint/page** — Accepts a CKB tx hash and confirms repo state existed by that block height.

### Acceptance Criteria

- [ ] Users can navigate the optional upgrade flow to connect a CCC wallet and claim their cell.
- [ ] Sovereign Passport DOB is minted on CKB.
- [ ] Public profile page renders passport data beautifully.
- [ ] Third parties can verify a developer's history via the verification page.

---

## Phase 4: Restore (Weeks 13-16)

> **Goal**: Users who lose access to their GitHub account can restore all repos using one of two explicit restore modes.

### Deliverables

- [ ] **rivet-cli package** — npm installable CLI tool
- [ ] **Exact Restore Mode** — Push raw mirror bundle. Preserves cryptographical perfection, but GitHub contribution graph does not light up.
- [ ] **Attribution Restore Mode** — Uses `git-filter-repo` to remap old emails to new emails so the GitHub graph lights up.
- [ ] **Hash Mapping Proof** — Anchor a proof (Old Hash -> New Hash) on CKB to cryptographically link the altered Attribution Restore commits to the original Merkle root.
- [ ] **Restore wizard UI** — Step-by-step web interface for restore.

### Acceptance Criteria

- [ ] User can select between Exact and Attribution restore.
- [ ] Attribution restore successfully lights up the GitHub graph on the new account.
- [ ] Hash Mapping Proof successfully verifies the Attribution restore against the original anchor.

---

## Phase 5: Social Features (Weeks 17+)
*(Standard Web2 Features)*
- **Stars / Likes**, **Forks**, **Code search**, **Activity feed**, **Organizations**.

## Phase 6: Full Platform (Future)
*(GitHub Alternative)*
- **Pull requests**, **Issues**, **CI/CD hooks**, **Package registry**, **Fiber Network payments (Protocol Fees)**.

---

## Risk Register

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| CoTA Subsidy Cost | 150 CKB per user drains treasury | Medium | Lazy initialization (only pay after first successful backup), anti-Sybil checks. |
| IPFS pinning unreliable | Code becomes inaccessible | Low | Arweave permanent backup + multiple pin services. |
| GitHub API rate limits | Can't fetch repo data | Medium | Cache aggressively, use GitHub tokens, local cloning. |
| Scope creep | Never ship | High | Strict phase gates — no Phase 2 features in Phase 1. |
