# Development Phases & Roadmap

> This document breaks down Rivet into actionable phases with clear milestones, deliverables, and acceptance criteria.

---

## Phase Overview

```
Phase 1          Phase 2           Phase 3            Phase 4           Phase 5          Phase 6
Foundation       Backup Engine     Sovereign          Restore           Social           Full
                                   Passport                             Features         Platform
                                   
[Web UI]         [Git Mirror]      [RGB++ DOB]        [Restore CLI]    [Stars/Forks]    [PRs/Issues]
[CCC Auth]       [IPFS Upload]     [Passport Mint]    [Email Remap]    [Search]         [CI/CD]
[Repo Viewer]    [CKB Anchor]      [Public Profile]   [GitHub Push]    [Notifications]  [Packages]
[Dashboard]      [Merkle Tree]     [Verify Page]      [Graph Restore]  [Orgs/Teams]     [API]

── Weeks 1-4 ──  ── Weeks 5-8 ──  ── Weeks 9-12 ──  ── Weeks 13-16 ── ── Weeks 17+ ── ── Future ──
```

---

## Phase 1: Foundation (Weeks 1-4)

> **Goal**: A working web platform where users can connect their wallet, link their GitHub account, and browse their repositories with full code viewing and commit history.

### Why This Phase First

- Gives users something **visible and tangible** immediately
- Establishes the **authentication pattern** (CCC wallet) used everywhere
- Creates the **data models** and **API patterns** everything else builds on
- Can be demoed and shared for early feedback

### Deliverables

#### Week 1-2: Project Setup & Core UI

- [ ] **Monorepo setup** — pnpm workspaces, TypeScript config, ESLint, Prettier
- [ ] **Next.js app** — App Router, layout system, dark theme, design system
- [ ] **Landing page** — Hero section explaining Rivet, call-to-action
- [ ] **CCC wallet integration** — Connect button, wallet selection modal, session management
- [ ] **Database schema v1** — Users, repositories, backups tables
- [ ] **API server** — Fastify with health check, CORS, auth middleware

#### Week 3-4: Repository Viewer

- [ ] **GitHub OAuth integration** — Fetch user's repo list from GitHub API
- [ ] **Repository list page** — Grid/list of user's repos with metadata
- [ ] **Repository detail page** — File tree browser, click to view files
- [ ] **File viewer** — Syntax-highlighted code display (Shiki or Prism)
- [ ] **Commit history page** — Scrollable list of commits with dates, messages, authors
- [ ] **Commit detail page** — Diff view showing what changed
- [ ] **Dashboard** — Overview of user's repos, backup status, account health

### Acceptance Criteria

- [ ] User can connect MetaMask/JoyID/UniSat via CCC
- [ ] User can link their GitHub account (OAuth)
- [ ] User sees a list of their GitHub repos on the dashboard
- [ ] User can browse files in any repo with syntax highlighting
- [ ] User can view full commit history with original dates
- [ ] User can view individual commit diffs
- [ ] All pages are responsive (mobile + desktop)
- [ ] Dark mode by default with premium aesthetic

### Tech Decisions for Phase 1

| Decision | Choice | Rationale |
|---|---|---|
| Package manager | pnpm | Efficient for monorepos, fast installs |
| Styling | CSS Modules + CSS Variables | No framework dependency, full control |
| Code highlighting | Shiki | Server-side rendering, accurate themes |
| Icons | Lucide React | Lightweight, comprehensive |
| Git data (Phase 1) | GitHub API | We use GitHub API directly first; IPFS mirrors come in Phase 2 |

---

## Phase 2: Backup Engine (Weeks 5-8)

> **Goal**: Users can backup their GitHub repositories to IPFS and anchor cryptographic rivets on CKB. Code is now decentralized and verifiable.

### Deliverables

#### Week 5-6: Git Mirroring & IPFS Storage

- [ ] **Git mirror service** — `git clone --mirror` for each repository
- [ ] **Git bundle creation** — Package mirror into transferable bundle
- [ ] **IPFS upload** — Upload git bundles to IPFS via Helia
- [ ] **CID tracking** — Store IPFS CIDs in database per repo
- [ ] **Backup progress UI** — Real-time progress bar during backup
- [ ] **IPFS-based file browser** — Switch repo viewer from GitHub API to IPFS-stored data

#### Week 7-8: CKB Anchoring & Merkle Trees

- [ ] **Merkle tree computation** — Build tree from commit hashes
- [ ] **Timestamp Cell creation** — Write Merkle root to CKB Cell via CCC
- [ ] **Transaction tracking** — Monitor CKB tx confirmation status
- [ ] **Verification endpoint** — API to verify a backup against its CKB anchor
- [ ] **Backup history page** — Timeline of all backups with CKB tx links
- [ ] **On-chain badge** — "Verified on CKB" indicator on backed-up repos

### Acceptance Criteria

- [ ] User can click "Backup" on any repo
- [ ] Backup clones the full mirror and uploads to IPFS
- [ ] Merkle root is computed and anchored on CKB (testnet first)
- [ ] User can see CKB transaction hash and link to explorer
- [ ] Repo viewer works from IPFS data (not just GitHub API)
- [ ] Verification endpoint confirms integrity
- [ ] Backup can be triggered for all repos at once

---

## Phase 3: Sovereign Passport (Weeks 9-12)

> **Goal**: Users can mint their "Sovereign Passport" — an RGB++ Spore DOB that represents their entire developer identity and history on-chain.

### Deliverables

#### Week 9-10: Passport DOB Minting

- [ ] **Spore DOB design** — Define the Sovereign Passport data schema
- [ ] **Passport minting** — Create RGB++ Spore DOB via CCC SDK
- [ ] **Passport updater** — Update the DOB when new backups are made
- [ ] **CKB Cell explorer** — View raw Cell data for your passport

#### Week 11-12: Public Profile

- [ ] **Public profile page** — `rivet.dev/{username}` showing:
  - Sovereign Passport summary
  - Repository list with backup status
  - Total commits, repos, and contribution timeline
  - CKB verification links
- [ ] **Embeddable badge** — "Verified by Rivet" badge for READMEs
- [ ] **Passport sharing** — Shareable link and QR code
- [ ] **Verification widget** — Third parties can verify any developer's passport

### Acceptance Criteria

- [ ] User can mint a Sovereign Passport DOB on CKB
- [ ] Passport contains aggregated stats (repos, commits, dates)
- [ ] Public profile page renders passport data beautifully
- [ ] Third parties can verify a developer's history via the passport
- [ ] Embeddable badge works in GitHub READMEs

---

## Phase 4: Restore (Weeks 13-16)

> **Goal**: Users who lose access to their GitHub account can restore all repos — with original timestamps — to a new account.

### Deliverables

#### Week 13-14: CLI Restore Tool

- [ ] **rivet-cli package** — npm installable CLI tool
- [ ] **`rivet restore` command** — Download from IPFS, remap emails, push to GitHub
- [ ] **Email remapping** — `git-filter-repo` integration for author email changes
- [ ] **Selective restore** — Choose which repos to restore
- [ ] **Dry run mode** — Preview what will be pushed before executing

#### Week 15-16: Web-Based Restore

- [ ] **Restore wizard UI** — Step-by-step web interface for restore
- [ ] **New GitHub account linking** — OAuth flow for the new account
- [ ] **Restore progress** — Real-time status of restore operation
- [ ] **Post-restore verification** — Verify restored repos match CKB anchor
- [ ] **Identity migration** — On-chain rivet linking old identity to new identity

### Acceptance Criteria

- [ ] User can restore repos via CLI with one command
- [ ] Restored repos have original commit timestamps
- [ ] GitHub contribution graph lights up with historical dates
- [ ] Email remapping works correctly (old email → new email)
- [ ] Web-based restore wizard works end-to-end
- [ ] On-chain identity migration is verifiable

---

## Phase 5: Social Features (Weeks 17+)

> **Goal**: Transform Rivet from a backup tool into a social code platform.

### Deliverables

- [ ] **Stars / Likes** — Star repos, stored in PostgreSQL
- [ ] **Forks** — Fork a Rivet repo into your own namespace
- [ ] **Code search** — MeiliSearch-powered full-text code search
- [ ] **Activity feed** — See what developers you follow are backing up
- [ ] **Notifications** — Email/push notifications for backup status
- [ ] **Organizations** — Team accounts with shared repos
- [ ] **Discovery page** — Trending repos, recently backed up, most verified

### Acceptance Criteria

- [ ] Users can star and fork repos
- [ ] Full-text search works across all public repos
- [ ] Activity feed shows relevant updates
- [ ] Organization accounts work with role-based access

---

## Phase 6: Full Platform (Future)

> **Goal**: Rivet becomes a complete GitHub alternative where developers can collaborate natively.

### Deliverables

- [ ] **Pull requests** — Propose and review code changes
- [ ] **Issues** — Bug reports and feature requests
- [ ] **Code review** — Inline comments, approvals, change requests
- [ ] **CI/CD hooks** — Trigger external CI/CD on push
- [ ] **Package registry** — IPFS-backed npm/cargo/pip registry
- [ ] **Fiber payments** — Sponsorships and bounties via Fiber Network
- [ ] **DAO governance** — Token-based project governance
- [ ] **Self-hostable** — Anyone can run their own Rivet instance

---

## Milestone Summary

| Milestone | Target | Key Metric |
|---|---|---|
| **M1: First Login** | Week 2 | User connects wallet and sees their GitHub repos |
| **M2: Code Browsing** | Week 4 | User browses files and commits on Rivet |
| **M3: First Backup** | Week 6 | Repo successfully mirrored to IPFS |
| **M4: First Anchor** | Week 8 | Merkle root written to CKB Cell |
| **M5: First Passport** | Week 10 | Sovereign Passport DOB minted |
| **M6: Public Profile** | Week 12 | Public profile page live |
| **M7: First Restore** | Week 14 | Repo restored to new GitHub with original dates |
| **M8: Social Launch** | Week 18 | Stars, search, and discovery features live |

---

## Risk Register

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| CKB transaction costs too high | Users won't anchor | Medium | Batch multiple repos into single Merkle root |
| IPFS pinning unreliable | Code becomes inaccessible | Low | Arweave permanent backup + multiple pin services |
| GitHub API rate limits | Can't fetch repo data | Medium | Cache aggressively, use GitHub tokens, local cloning |
| CCC wallet UX confusing | Users drop off at onboarding | Medium | JoyID (passkey-based, no extension needed) as default |
| Scope creep | Never ship | High | Strict phase gates — no Phase 2 features in Phase 1 |
| Key management burden | Users lose access to passport | Medium | Clear key backup guides, multi-sig support |
