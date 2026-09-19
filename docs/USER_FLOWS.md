# User Flows

> This document describes every user journey in Rivet, step by step. Use this as a reference for UI design, API endpoints, and acceptance testing.

---

## Table of Contents

1. [Flow 1: First-Time User Onboarding](#flow-1-first-time-user-onboarding)
2. [Flow 2: Browsing Code on Rivet](#flow-2-browsing-code-on-rivet)
3. [Flow 3: Backing Up Repositories](#flow-3-backing-up-repositories)
4. [Flow 4: Viewing Backup Rivet](#flow-4-viewing-backup-rivet)
5. [Flow 5: Minting Sovereign Passport](#flow-5-minting-sovereign-passport)
6. [Flow 6: Restoring to New GitHub Account](#flow-6-restoring-to-new-github-account)
7. [Flow 7: Public Profile Viewing (Visitor)](#flow-7-public-profile-viewing-visitor)
8. [Flow 8: Verifying Another Developer's Work](#flow-8-verifying-another-developers-work)

---

## Flow 1: First-Time User Onboarding

### User Story
> *As a developer, I want to sign up for Rivet using my crypto wallet and link my GitHub account, so I can start backing up my code.*

### Step-by-Step

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Landing Page                                   │
│                                                         │
│  User visits rivet.dev                                  │
│  Sees: Hero section, value proposition, CTA button      │
│  Action: Clicks "Get Started" or "Connect Wallet"       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Wallet Connection                              │
│                                                         │
│  CCC wallet modal opens                                 │
│  Options: MetaMask, JoyID, UniSat, OKX                  │
│  User selects wallet → approves connection              │
│  Result: CKB address derived                            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: Sign Auth Challenge                            │
│                                                         │
│  Rivet asks wallet to sign a message                    │
│  "rivet-auth-{nonce}" signed by user                    │
│  Result: JWT session token issued                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: Profile Setup                                  │
│                                                         │
│  User enters display name (optional)                    │
│  User uploads avatar (optional)                         │
│  User sets bio (optional)                               │
│  Result: Profile created in PostgreSQL                  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 5: Link GitHub Account                            │
│                                                         │
│  User clicks "Link GitHub"                              │
│  GitHub OAuth flow opens                                │
│  User authorizes Rivet to read repos                    │
│  Result: GitHub token stored, repos fetched             │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 6: Dashboard                                      │
│                                                         │
│  User sees their GitHub repos listed                    │
│  Each repo shows: name, description, language, status   │
│  All repos show "Not backed up" initially               │
│  User can click any repo to browse code                 │
│  User can click "Backup All" to start backing up        │
└─────────────────────────────────────────────────────────┘
```

### Pages Involved
- `/` — Landing page
- `/dashboard` — Main dashboard (after auth)
- `/settings/profile` — Profile setup
- `/settings/github` — GitHub linking

---

## Flow 2: Browsing Code on Rivet

### User Story
> *As a developer, I want to browse my code on Rivet just like I would on GitHub — view files, read code, and see commit history with original timestamps.*

### Step-by-Step

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Repository List                                │
│                                                         │
│  User navigates to /dashboard or /jedi (profile)        │
│  Sees grid of repositories with:                        │
│  - Repo name, description                               │
│  - Primary language (color-coded)                        │
│  - Backup status badge (✅ Backed up / ⏳ Pending)      │
│  - Last commit date                                     │
│  Action: Clicks on "my-project"                         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Repository Overview                            │
│                                                         │
│  URL: /jedi/my-project                                  │
│  Shows:                                                 │
│  - Repo name + description                              │
│  - Branch selector dropdown                              │
│  - File tree (folders first, then files)                │
│  - README.md rendered below file tree                   │
│  - Sidebar: stats (commits, branches, tags, size)       │
│  - Sidebar: backup status with CKB link                 │
│  Action: Clicks on "src/" folder                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: File Browser                                   │
│                                                         │
│  URL: /jedi/my-project/tree/main/src                    │
│  Shows:                                                 │
│  - Breadcrumb: my-project / src /                       │
│  - File list with last commit message per file          │
│  Action: Clicks on "index.ts"                           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: File Viewer                                    │
│                                                         │
│  URL: /jedi/my-project/blob/main/src/index.ts           │
│  Shows:                                                 │
│  - Syntax-highlighted code                              │
│  - Line numbers                                         │
│  - File size, line count                                │
│  - "Last modified: March 15, 2019" (original date!)     │
│  - "Raw" button to view raw content                     │
│  - "Copy" button                                        │
└─────────────────────────────────────────────────────────┘
```

### Alternate Path: Commit History

```
┌─────────────────────────────────────────────────────────┐
│  STEP 2b: Commit History                                │
│                                                         │
│  URL: /jedi/my-project/commits/main                     │
│  Shows paginated list of commits:                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  abc123f  "Add new feature X"                   │   │
│  │  by jedi • September 18, 2026 at 4:00 PM        │   │
│  │  ──────────────────────────────────────────────  │   │
│  │  def456a  "Fix bug in parser"                   │   │
│  │  by jedi • September 15, 2026 at 10:30 AM       │   │
│  │  ──────────────────────────────────────────────  │   │
│  │  789bcd0  "Initial commit"                      │   │
│  │  by jedi • March 15, 2019 at 10:30 AM  ← OLD!  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Action: Clicks on commit "abc123f"                     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2c: Commit Detail (Diff View)                     │
│                                                         │
│  URL: /jedi/my-project/commit/abc123f                   │
│  Shows:                                                 │
│  - Commit message + body                                │
│  - Author: jedi <jedi@email.com>                       │
│  - Date: September 18, 2026 at 4:00 PM                 │
│  - Parent commit: def456a                               │
│  - Files changed: 3 files (+45, -12)                   │
│  - Diff for each file (green = added, red = removed)   │
└─────────────────────────────────────────────────────────┘
```

### Pages Involved
- `/dashboard` — Repo list
- `/{username}` — Public profile with repo list
- `/{username}/{repo}` — Repo overview + file tree
- `/{username}/{repo}/tree/{branch}/{path}` — Directory browser
- `/{username}/{repo}/blob/{branch}/{path}` — File viewer
- `/{username}/{repo}/commits/{branch}` — Commit history
- `/{username}/{repo}/commit/{hash}` — Commit detail/diff

---

## Flow 3: Backing Up Repositories

### User Story
> *As a developer, I want to back up my GitHub repos to IPFS and anchor them on CKB, so my code is permanently safe.*

### Step-by-Step

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Trigger Backup                                 │
│                                                         │
│  On Dashboard, user clicks "Backup All" or selects      │
│  specific repos and clicks "Backup Selected"            │
│                                                         │
│  Confirmation modal:                                    │
│  "Back up 47 repositories to IPFS and anchor on CKB?"  │
│  "Estimated cost: ~200 CKB ($1.00)"                    │
│  [Cancel] [Confirm & Sign]                              │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Backup Progress                                │
│                                                         │
│  Real-time progress page shows:                         │
│                                                         │
│  ⬛⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜⬜  67% complete                │
│                                                         │
│  ✅ Cloning repositories... (47/47 complete)            │
│  ✅ Computing Merkle tree... done                       │
│  🔄 Uploading to IPFS... (32/47 repos)                 │
│  ⏳ Anchoring on CKB... waiting                        │
│  ⏳ Confirming transaction... waiting                   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: Wallet Signature                               │
│                                                         │
│  After IPFS upload, CCC prompts wallet to sign the     │
│  CKB transaction that creates the Timestamp Cell        │
│                                                         │
│  User approves in their wallet (MetaMask/JoyID/etc)     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: Backup Complete                                │
│                                                         │
│  Success screen:                                        │
│                                                         │
│  ✅ Backup Complete!                                    │
│                                                         │
│  47 repositories backed up                              │
│  3,241 commits preserved                                │
│  Merkle root: 0x7a8b3c...                              │
│  IPFS CID: bafybeig...                                 │
│  CKB Transaction: 0xdef456... [View on Explorer ↗]     │
│                                                         │
│  Your code is now permanently backed up and provable.   │
│                                                         │
│  [View Backup Details] [Go to Dashboard]                │
└─────────────────────────────────────────────────────────┘
```

---

## Flow 4: Viewing Backup Rivet

### User Story
> *As a developer, I want to see rivet that my code is anchored on CKB, with links to the blockchain explorer.*

### Step-by-Step

```
┌─────────────────────────────────────────────────────────┐
│  Page: /dashboard/backups                               │
│                                                         │
│  Backup History:                                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  📦 Backup #3 — Sept 18, 2026                   │   │
│  │  47 repos, 3,241 commits                         │   │
│  │  Status: ✅ Confirmed on CKB (Block #12,345,678)│   │
│  │  [View Details] [Verify] [View on CKB Explorer]  │   │
│  ├─────────────────────────────────────────────────┤   │
│  │  📦 Backup #2 — Aug 1, 2026                     │   │
│  │  45 repos, 2,890 commits                         │   │
│  │  Status: ✅ Confirmed on CKB (Block #12,100,000)│   │
│  │  [View Details] [Verify] [View on CKB Explorer]  │   │
│  ├─────────────────────────────────────────────────┤   │
│  │  📦 Backup #1 — Jun 15, 2026                    │   │
│  │  40 repos, 2,400 commits                         │   │
│  │  Status: ✅ Confirmed on CKB (Block #11,800,000)│   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Flow 5: Minting Sovereign Passport

### User Story
> *As a developer, I want to mint a Sovereign Passport DOB that proves my entire developer identity and history on-chain.*

### Step-by-Step

```
STEP 1: User has at least 1 confirmed backup
STEP 2: User navigates to /dashboard/passport
STEP 3: Passport preview shows aggregated stats:
        - Total repos, commits, languages
        - Timeline of contributions
        - All backup records
STEP 4: User clicks "Mint Sovereign Passport"
STEP 5: CCC prompts wallet to sign Spore DOB creation tx
STEP 6: Transaction confirmed → Passport DOB exists on CKB
STEP 7: Public profile now shows Sovereign Passport badge
STEP 8: User gets a shareable link: rivet.dev/jedi/passport
```

---

## Flow 6: Restoring to New GitHub Account

### User Story
> *As a developer whose GitHub account was suspended, I want to restore all my code to a new GitHub account with original timestamps intact.*

### Step-by-Step

```
┌─────────────────────────────────────────────────────────┐
│  STEP 1: Start Restore                                  │
│                                                         │
│  User logs into Rivet with wallet (same wallet as       │
│  before — the wallet IS their identity)                 │
│                                                         │
│  Dashboard shows all backed-up repos                    │
│  User clicks "Restore to GitHub"                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2: Restore Wizard                                 │
│                                                         │
│  Page 1: "Link your new GitHub account"                 │
│  → OAuth flow for new GitHub account                    │
│                                                         │
│  Page 2: "Enter your new email"                         │
│  → new@email.com (for commit attribution)               │
│                                                         │
│  Page 3: "Select repos to restore"                      │
│  → Checkboxes for each repo (default: all)              │
│                                                         │
│  Page 4: "Review & Confirm"                             │
│  → Summary of what will be pushed                       │
│  → "Old email → New email" mapping preview              │
│  → [Start Restore]                                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3: Restore Progress                               │
│                                                         │
│  ✅ Downloaded backup from IPFS                         │
│  ✅ Verified Merkle root against CKB                    │
│  🔄 Remapping author emails...                          │
│  🔄 Pushing repos to GitHub... (12/47)                  │
│                                                         │
│  my-project       ✅ pushed (847 commits)               │
│  ckb-tools        ✅ pushed (123 commits)               │
│  old-project      ✅ pushed (12 commits)                │
│  web-app          🔄 pushing... (234/500 commits)       │
│  ...                                                    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4: Restore Complete                               │
│                                                         │
│  ✅ Restore Complete!                                   │
│                                                         │
│  47 repositories restored to github.com/new-jedi        │
│  3,241 commits with ORIGINAL timestamps                 │
│  Contribution graph: ██████████████████ (fully restored)│
│                                                         │
│  Verified against CKB: ✅ All hashes match              │
│                                                         │
│  ⛓️ Identity migration recorded on CKB:                 │
│  "ckb1q...abc previously known as github.com/jedi,      │
│   now github.com/new-jedi"                              │
│                                                         │
│  [View on GitHub] [View CKB Rivet]                      │
└─────────────────────────────────────────────────────────┘
```

---

## Flow 7: Public Profile Viewing (Visitor)

### User Story
> *As a visitor (recruiter, collaborator, or verifier), I want to see a developer's public Rivet profile showing their verified coding history.*

```
┌─────────────────────────────────────────────────────────┐
│  Page: rivet.dev/jedi                                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  👤 jedi                                         │   │
│  │  🛡️ Sovereign Passport Verified                  │   │
│  │  📍 ckb1q...abc                                  │   │
│  │                                                   │   │
│  │  📊 Stats:                                        │   │
│  │  47 repos • 3,241 commits • Since March 2019     │   │
│  │  TypeScript, Rust, Python                         │   │
│  │                                                   │   │
│  │  🔐 On-Chain Rivet:                               │   │
│  │  CKB Tx: 0xdef456... [View on Explorer ↗]        │   │
│  │  Last verified: September 18, 2026               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Repositories:                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  📁 my-project      ✅ Backed Up                │   │
│  │  "A cool project"   TypeScript • 847 commits     │   │
│  │                                                   │   │
│  │  📁 ckb-tools        ✅ Backed Up                │   │
│  │  "CKB developer tools" Rust • 123 commits        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Flow 8: Verifying Another Developer's Work

### User Story
> *As a third party (employer, auditor, collaborator), I want to verify that a developer's claimed work history is genuine by checking their CKB rivet.*

```
STEP 1: Visit rivet.dev/jedi (or any public profile)
STEP 2: Click "Verify" next to any backup
STEP 3: Verification page shows:
        - Merkle root from CKB Cell
        - Recomputed Merkle root from IPFS backup
        - Match status: ✅ VERIFIED or ❌ MISMATCH
        - CKB block number + timestamp
        - Link to CKB Explorer for independent verification
STEP 4: For deep verification, user can:
        - Download the IPFS backup themselves
        - Recompute the Merkle root independently
        - Check the CKB Cell directly via any CKB node
```

---

## URL Structure Summary

| URL Pattern | Page | Auth Required |
|---|---|---|
| `/` | Landing page | No |
| `/dashboard` | User dashboard | Yes |
| `/dashboard/backups` | Backup history | Yes |
| `/dashboard/passport` | Sovereign Passport management | Yes |
| `/dashboard/restore` | Restore wizard | Yes |
| `/settings/profile` | Profile settings | Yes |
| `/settings/github` | GitHub account linking | Yes |
| `/{username}` | Public profile | No |
| `/{username}/{repo}` | Repository overview | No (public repos) |
| `/{username}/{repo}/tree/{branch}/{path}` | Directory browser | No (public repos) |
| `/{username}/{repo}/blob/{branch}/{path}` | File viewer | No (public repos) |
| `/{username}/{repo}/commits/{branch}` | Commit history | No (public repos) |
| `/{username}/{repo}/commit/{hash}` | Commit detail/diff | No (public repos) |
| `/{username}/passport` | Sovereign Passport viewer | No |
| `/verify/{ckb_tx_hash}` | Verification page | No |
| `/explore` | Discover repos and developers | No |
