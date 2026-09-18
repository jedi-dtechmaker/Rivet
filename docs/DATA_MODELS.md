# Data Models

> This document defines all data structures used in Rivet — on-chain CKB Cells, database schemas, and API data types.

---

## Table of Contents

1. [On-Chain Data (CKB Cells)](#on-chain-data-ckb-cells)
2. [Database Schema (PostgreSQL)](#database-schema-postgresql)
3. [IPFS Data Structures](#ipfs-data-structures)
4. [API Data Types (TypeScript)](#api-data-types-typescript)
5. [Data Flow Between Layers](#data-flow-between-layers)

---

## On-Chain Data (CKB Cells)

### Cell 1: Timestamp Cell

Created during backup anchoring. One Cell per backup event.

```
┌─────────────────────────────────────────────────────────┐
│  TIMESTAMP CELL                                         │
│                                                         │
│  capacity: 200-500 CKBytes                              │
│                                                         │
│  data (serialized):                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  version:       u8        = 1                    │   │
│  │  merkle_root:   [u8; 32]  = 0x7a8b3c...         │   │
│  │  repo_count:    u32       = 47                   │   │
│  │  commit_count:  u32       = 3241                 │   │
│  │  ipfs_cid:      string    = "bafybeig..."       │   │
│  │  created_at:    u64       = 1726678590           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  lock_script:                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  code_hash: <secp256k1_blake160>                │   │
│  │  hash_type: type                                 │   │
│  │  args:      <owner's lock args>                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  type_script:                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  code_hash: <ProofTimestampTypeScript>           │   │
│  │  hash_type: type                                 │   │
│  │  args:      <unique_id>                          │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Cell 2: Sovereign Passport (Spore DOB)

Created when user mints their passport. Updated with each backup.

```
┌─────────────────────────────────────────────────────────┐
│  SOVEREIGN PASSPORT (Spore DOB)                         │
│                                                         │
│  capacity: ~500 CKBytes                                 │
│                                                         │
│  data (Spore format):                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  content_type: "application/json"                │   │
│  │  content: {                                      │   │
│  │    schema: "sovereign-passport/v1",              │   │
│  │    identity: {                                   │   │
│  │      ckb_address: "ckb1q...abc",                │   │
│  │      display_name: "jedi",                       │   │
│  │      avatar_ipfs_cid: "bafybeig...",            │   │
│  │      github_username_hash: "sha256('jedi')",    │   │
│  │      created_at: 1726678590                      │   │
│  │    },                                            │   │
│  │    stats: {                                      │   │
│  │      total_repos: 47,                            │   │
│  │      total_commits: 3241,                        │   │
│  │      first_commit_date: "2019-03-15",           │   │
│  │      last_backup_date: "2026-09-18",            │   │
│  │      languages: ["TypeScript", "Rust", "Python"] │   │
│  │    },                                            │   │
│  │    backups: [                                    │   │
│  │      {                                           │   │
│  │        timestamp_tx: "0xabc...",                 │   │
│  │        merkle_root: "0x7a8b3c...",              │   │
│  │        ipfs_cid: "bafybeig...",                 │   │
│  │        repo_count: 47,                           │   │
│  │        date: "2026-09-18"                        │   │
│  │      }                                           │   │
│  │    ]                                             │   │
│  │  }                                               │   │
│  │  cluster_id: <Rivet_PASSPORT_CLUSTER>            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  lock_script: <owner's lock>                            │
│  type_script: <SporeTypeScript>                         │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema (PostgreSQL)

### Table: `users`

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ckb_address     VARCHAR(100) UNIQUE NOT NULL,  -- Primary identity
    display_name    VARCHAR(50),
    avatar_url      TEXT,
    bio             TEXT,

    -- GitHub(optional, for fetching repos)
    github_id       BIGINT UNIQUE,
    github_username VARCHAR(39),
    github_token    TEXT,                           -- Encrypted OAuth token

    -- Sovereign Passport
    passport_tx     VARCHAR(66),                   -- CKB tx hash of passport DOB
    passport_cell   JSONB,                         -- Cached passport Cell data

    -- Metadata
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_ckb_address ON users(ckb_address);
CREATE INDEX idx_users_github_username ON users(github_username);
```

### Table: `repositories`

```sql
CREATE TABLE repositories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Repository info
    name            VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255) NOT NULL,         -- "user/repo-name"
    description     TEXT,
    is_private      BOOLEAN DEFAULT FALSE,
    default_branch  VARCHAR(255) DEFAULT 'main',
    language        VARCHAR(50),
    stars_count     INTEGER DEFAULT 0,

    -- Source (where was this imported from)
    source_platform VARCHAR(20) DEFAULT 'github',  -- 'github', 'gitlab', etc.
    source_id       BIGINT,                        -- Platform-specific ID
    source_url      TEXT,                          -- Original URL

    -- Backup status
    backup_status   VARCHAR(20) DEFAULT 'pending', -- pending, backing_up, backed_up, failed
    last_backup_at  TIMESTAMP WITH TIME ZONE,
    backup_count    INTEGER DEFAULT 0,

    -- Metadata
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, full_name)
);

CREATE INDEX idx_repos_user_id ON repositories(user_id);
CREATE INDEX idx_repos_full_name ON repositories(full_name);
CREATE INDEX idx_repos_backup_status ON repositories(backup_status);
```

### Table: `backups`

```sql
CREATE TABLE backups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What was backed up
    repo_count      INTEGER NOT NULL,
    commit_count    INTEGER NOT NULL,

    -- Merkle rivet
    merkle_root     VARCHAR(66) NOT NULL,          -- 0x-prefixed hex
    merkle_tree     JSONB,                         -- Full tree for rivet generation

    -- Storage references
    ipfs_cid        VARCHAR(100) NOT NULL,         -- IPFS CID of backup archive
    arweave_tx      VARCHAR(66),                   -- Arweave tx (optional, for permanent backup)

    -- CKB anchor
    ckb_tx_hash     VARCHAR(66),                   -- CKB transaction hash
    ckb_block_num   BIGINT,                        -- Block number when confirmed
    ckb_status      VARCHAR(20) DEFAULT 'pending', -- pending, confirming, confirmed, failed
    ckb_confirmed_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    status          VARCHAR(20) DEFAULT 'processing', -- processing, completed, failed
    error_message   TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_backups_user_id ON backups(user_id);
CREATE INDEX idx_backups_ckb_tx_hash ON backups(ckb_tx_hash);
CREATE INDEX idx_backups_status ON backups(status);
```

### Table: `backup_repos`

Junction table linking backups to specific repositories.

```sql
CREATE TABLE backup_repos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id       UUID NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
    repository_id   UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,

    -- Per-repo data
    repo_merkle_root VARCHAR(66) NOT NULL,         -- Individual repo Merkle root
    commit_count     INTEGER NOT NULL,
    branch_count     INTEGER NOT NULL,
    tag_count        INTEGER NOT NULL,
    ipfs_cid         VARCHAR(100) NOT NULL,        -- IPFS CID of this repo's mirror

    -- Size info
    size_bytes       BIGINT,

    UNIQUE(backup_id, repository_id)
);

CREATE INDEX idx_backup_repos_backup_id ON backup_repos(backup_id);
CREATE INDEX idx_backup_repos_repository_id ON backup_repos(repository_id);
```

### Table: `restore_operations`

```sql
CREATE TABLE restore_operations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    backup_id           UUID NOT NULL REFERENCES backups(id),

    -- Restore target
    target_platform     VARCHAR(20) DEFAULT 'github',
    target_username     VARCHAR(255) NOT NULL,
    target_email        VARCHAR(255) NOT NULL,

    -- Status
    status              VARCHAR(20) DEFAULT 'pending', -- pending, restoring, completed, failed
    repos_total         INTEGER NOT NULL,
    repos_completed     INTEGER DEFAULT 0,
    error_message       TEXT,

    -- Verification
    verification_status VARCHAR(20),                   -- pending, verified, mismatch
    verified_at         TIMESTAMP WITH TIME ZONE,

    -- Metadata
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at        TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_restores_user_id ON restore_operations(user_id);
CREATE INDEX idx_restores_status ON restore_operations(status);
```

---

## IPFS Data Structures

### Backup Archive Structure

Each backup uploads a structured archive to IPFS:

```
bafybeig... (root CID)
├── manifest.json           # Archive metadata
├── repos/
│   ├── my-project.bundle   # Git bundle (full mirror)
│   ├── ckb-tools.bundle
│   └── old-project.bundle
└── merkle/
    ├── tree.json            # Full Merkle tree
    └── rivets/
        ├── my-project.json  # Individual repo Merkle rivet
        ├── ckb-tools.json
        └── old-project.json
```

### manifest.json

```json
{
  "version": 1,
  "schema": "rivet-backup/v1",
  "owner_ckb_address": "ckb1q...abc",
  "created_at": "2026-09-18T16:00:00Z",
  "merkle_root": "0x7a8b3c...",
  "repos": [
    {
      "name": "my-project",
      "full_name": "jedi/my-project",
      "bundle_path": "repos/my-project.bundle",
      "merkle_rivet_path": "merkle/rivets/my-project.json",
      "commit_count": 847,
      "branch_count": 5,
      "tag_count": 12,
      "size_bytes": 15728640,
      "first_commit": "2019-03-15T10:30:00Z",
      "last_commit": "2026-09-18T15:45:00Z"
    }
  ],
  "signature": "0x..."
}
```

---

## API Data Types (TypeScript)

### Core Types

```typescript
// packages/core/src/types.ts

// === Identity ===
export interface User {
  id: string;
  ckbAddress: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  githubUsername: string | null;
  passportTxHash: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

// === Repository ===
export interface Repository {
  id: string;
  userId: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  language: string | null;
  starsCount: number;
  sourcePlatform: 'github' | 'gitlab' | 'bitbucket';
  sourceUrl: string | null;
  backupStatus: BackupStatus;
  lastBackupAt: Date | null;
  backupCount: number;
  createdAt: Date;
}

export type BackupStatus = 'pending' | 'backing_up' | 'backed_up' | 'failed';

// === Backup ===
export interface Backup {
  id: string;
  userId: string;
  repoCount: number;
  commitCount: number;
  merkleRoot: string;
  ipfsCid: string;
  arweaveTx: string | null;
  ckbTxHash: string | null;
  ckbBlockNumber: number | null;
  ckbStatus: CkbStatus;
  status: 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt: Date | null;
}

export type CkbStatus = 'pending' | 'confirming' | 'confirmed' | 'failed';

// === Restore ===
export interface RestoreOperation {
  id: string;
  userId: string;
  backupId: string;
  targetPlatform: string;
  targetUsername: string;
  targetEmail: string;
  status: 'pending' | 'restoring' | 'completed' | 'failed';
  reposTotal: number;
  reposCompleted: number;
  verificationStatus: 'pending' | 'verified' | 'mismatch' | null;
  createdAt: Date;
  completedAt: Date | null;
}

// === Git Data (for web viewer) ===
export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  body: string | null;
  authorName: string;
  authorEmail: string;
  authorDate: Date;           // Original timestamp — always preserved
  committerName: string;
  committerEmail: string;
  committerDate: Date;
  parentHashes: string[];
}

export interface GitTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;        // null for directories
  hash: string;
}

export interface GitFileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  language: string | null;
}

export interface GitDiff {
  oldPath: string;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

// === Verification ===
export interface VerificationResult {
  isValid: boolean;
  onChainMerkleRoot: string;
  computedMerkleRoot: string;
  timestamp: number;
  txHash: string;
  blockNumber: number;
  explorerUrl: string;
}

// === Sovereign Passport ===
export interface SovereignPassport {
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
  backups: {
    timestampTx: string;
    merkleRoot: string;
    ipfsCid: string;
    repoCount: number;
    date: string;
  }[];
}
```

---

## Data Flow Between Layers

### Where Each Piece of Data Lives

```
┌─────────────────────────────────────────────────────────────────┐
│                          DATA MAP                               │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │    PostgreSQL     │  │      IPFS        │  │     CKB      │ │
│  │                   │  │                  │  │              │ │
│  │  • User accounts  │  │  • Git mirrors   │  │  • Merkle    │ │
│  │  • Repo metadata  │  │    (.bundle)     │  │    roots     │ │
│  │  • Backup records │  │  • Manifest      │  │  • Passport  │ │
│  │  • Search index   │  │  • Merkle rivets │  │    DOBs      │ │
│  │  • Activity log   │  │  • File blobs    │  │  • Identity  │ │
│  │  • Sessions       │  │                  │  │    Cells     │ │
│  │                   │  │                  │  │              │ │
│  │  Mutable ✏️       │  │  Immutable 🔒    │  │  Immutable 🔒│ │
│  │  Fast queries ⚡  │  │  Content-addr 📍 │  │  Verifiable ✅│ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
│  Rule: If it needs to be PROVEN → CKB                          │
│        If it needs to be STORED → IPFS                          │
│        If it needs to be QUERIED → PostgreSQL                   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Lifecycle

```
1. User links GitHub account
   → GitHub API returns repo list
   → PostgreSQL stores repo metadata

2. User triggers backup
   → Git Engine clones --mirror from GitHub
   → Git bundles uploaded to IPFS → CID stored in PostgreSQL
   → Merkle root computed from commit hashes
   → CKB transaction creates Timestamp Cell → tx hash stored in PostgreSQL

3. User views code on platform
   → PostgreSQL queried for repo metadata
   → IPFS fetched for file content (via Git Engine parsing the bundle)
   → Rendered in Next.js web UI

4. User mints Sovereign Passport
   → Stats aggregated from PostgreSQL
   → RGB++ Spore DOB created on CKB
   → Passport tx hash stored in PostgreSQL

5. User restores to new GitHub
   → Backup record fetched from PostgreSQL
   → Git bundle downloaded from IPFS
   → Emails remapped via git-filter-repo
   → Pushed to new GitHub account
   → Verification run against CKB Merkle root
```
