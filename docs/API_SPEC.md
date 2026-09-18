# API Specification

> REST API specification for the Rivet platform. All endpoints are served from the API server (Fastify).

---

## Base URL

- **Development**: `http://localhost:4000/api/v1`
- **Production**: `https://api.rivet.dev/v1`

## Authentication

All authenticated endpoints require a JWT bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

Tokens are obtained via the wallet authentication flow (see [Auth endpoints](#auth)).

---

## Endpoints

### Auth

#### `POST /auth/challenge`

Request a challenge nonce for wallet authentication.

**Request:**
```json
{
  "ckbAddress": "ckb1q...abc"
}
```

**Response:**
```json
{
  "challenge": "rivet-auth-a1b2c3d4e5f6",
  "expiresAt": "2026-09-18T17:10:00Z"
}
```

---

#### `POST /auth/verify`

Verify a signed challenge and receive a JWT token.

**Request:**
```json
{
  "ckbAddress": "ckb1q...abc",
  "challenge": "rivet-auth-a1b2c3d4e5f6",
  "signature": "0x..."
}
```

**Response:**
```json
{
  "token": "eyJhbG...",
  "user": {
    "id": "uuid",
    "ckbAddress": "ckb1q...abc",
    "displayName": "jedi",
    "githubUsername": "jedi",
    "passportTxHash": null,
    "createdAt": "2026-09-18T16:00:00Z"
  }
}
```

---

#### `POST /auth/github/link`

Link a GitHub account to the authenticated user.

**Auth required:** Yes

**Request:**
```json
{
  "githubOAuthCode": "abc123"
}
```

**Response:**
```json
{
  "githubUsername": "jedi",
  "repoCount": 47
}
```

---

### Users

#### `GET /users/:username`

Get a user's public profile.

**Auth required:** No

**Response:**
```json
{
  "id": "uuid",
  "ckbAddress": "ckb1q...abc",
  "displayName": "jedi",
  "avatarUrl": "https://...",
  "bio": "Building on CKB",
  "githubUsername": "jedi",
  "passportTxHash": "0xabc...",
  "stats": {
    "totalRepos": 47,
    "totalCommits": 3241,
    "totalBackups": 3,
    "memberSince": "2026-06-15T00:00:00Z"
  }
}
```

---

#### `PATCH /users/me`

Update the authenticated user's profile.

**Auth required:** Yes

**Request:**
```json
{
  "displayName": "Jedi Master",
  "bio": "Building the future of code ownership"
}
```

---

### Repositories

#### `GET /users/:username/repos`

List a user's repositories.

**Auth required:** No (public repos only) / Yes (includes private)

**Query params:**
- `page` (default: 1)
- `limit` (default: 20, max: 100)
- `sort` (options: `name`, `updated`, `created`, `stars`)
- `order` (options: `asc`, `desc`)
- `language` (filter by language)
- `backup_status` (filter: `pending`, `backed_up`, `failed`)

**Response:**
```json
{
  "repos": [
    {
      "id": "uuid",
      "name": "my-project",
      "fullName": "jedi/my-project",
      "description": "A cool project",
      "isPrivate": false,
      "defaultBranch": "main",
      "language": "TypeScript",
      "starsCount": 12,
      "backupStatus": "backed_up",
      "lastBackupAt": "2026-09-18T16:00:00Z",
      "backupCount": 3,
      "createdAt": "2019-03-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 47,
    "totalPages": 3
  }
}
```

---

#### `GET /repos/:repoId/tree/:branch/*path`

Get the file tree at a specific path and branch.

**Auth required:** No (public) / Yes (private)

**Response:**
```json
{
  "path": "src",
  "branch": "main",
  "entries": [
    {
      "name": "components",
      "path": "src/components",
      "type": "directory",
      "size": null,
      "hash": "abc123"
    },
    {
      "name": "index.ts",
      "path": "src/index.ts",
      "type": "file",
      "size": 1234,
      "hash": "def456"
    }
  ]
}
```

---

#### `GET /repos/:repoId/blob/:branch/*path`

Get the contents of a file.

**Auth required:** No (public) / Yes (private)

**Response:**
```json
{
  "path": "src/index.ts",
  "branch": "main",
  "content": "import { app } from './app';\n\napp.listen(3000);",
  "encoding": "utf-8",
  "size": 1234,
  "language": "typescript",
  "lastCommit": {
    "hash": "abc123f",
    "message": "Add new feature X",
    "authorName": "jedi",
    "authorDate": "2026-09-18T16:00:00Z"
  }
}
```

---

#### `GET /repos/:repoId/commits/:branch`

Get commit history for a branch.

**Auth required:** No (public) / Yes (private)

**Query params:**
- `page` (default: 1)
- `limit` (default: 30, max: 100)

**Response:**
```json
{
  "branch": "main",
  "commits": [
    {
      "hash": "abc123f",
      "shortHash": "abc123f",
      "message": "Add new feature X",
      "body": null,
      "authorName": "jedi",
      "authorEmail": "jedi@email.com",
      "authorDate": "2026-09-18T16:00:00Z",
      "committerDate": "2026-09-18T16:00:00Z",
      "parentHashes": ["def456a"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 847,
    "totalPages": 29
  }
}
```

---

#### `GET /repos/:repoId/commit/:hash`

Get a single commit with its diff.

**Auth required:** No (public) / Yes (private)

**Response:**
```json
{
  "commit": {
    "hash": "abc123f",
    "message": "Add new feature X",
    "authorName": "jedi",
    "authorEmail": "jedi@email.com",
    "authorDate": "2026-09-18T16:00:00Z",
    "parentHashes": ["def456a"],
    "stats": {
      "filesChanged": 3,
      "additions": 45,
      "deletions": 12
    }
  },
  "diffs": [
    {
      "oldPath": "src/index.ts",
      "newPath": "src/index.ts",
      "status": "modified",
      "hunks": [
        {
          "oldStart": 10,
          "oldLines": 3,
          "newStart": 10,
          "newLines": 5,
          "content": "@@ -10,3 +10,5 @@\n unchanged\n-old line\n+new line\n+another new line\n unchanged"
        }
      ]
    }
  ]
}
```

---

### Backups

#### `POST /backups`

Trigger a new backup.

**Auth required:** Yes

**Request:**
```json
{
  "repoIds": ["uuid1", "uuid2"],
  "includeAll": false
}
```

**Response:**
```json
{
  "backupId": "uuid",
  "status": "processing",
  "repoCount": 47,
  "estimatedCkbCost": 200,
  "createdAt": "2026-09-18T16:00:00Z"
}
```

---

#### `GET /backups/:backupId`

Get backup details.

**Auth required:** Yes

**Response:**
```json
{
  "id": "uuid",
  "status": "completed",
  "repoCount": 47,
  "commitCount": 3241,
  "merkleRoot": "0x7a8b3c...",
  "ipfsCid": "bafybeig...",
  "ckbTxHash": "0xdef456...",
  "ckbBlockNumber": 12345678,
  "ckbStatus": "confirmed",
  "ckbConfirmedAt": "2026-09-18T16:05:00Z",
  "repos": [
    {
      "name": "my-project",
      "commitCount": 847,
      "branchCount": 5,
      "tagCount": 12,
      "ipfsCid": "bafybeig...",
      "merkleRoot": "0xaaa..."
    }
  ],
  "createdAt": "2026-09-18T16:00:00Z",
  "completedAt": "2026-09-18T16:04:30Z"
}
```

---

#### `GET /backups/:backupId/progress`

Get real-time backup progress (WebSocket upgrade available).

**Auth required:** Yes

**Response:**
```json
{
  "backupId": "uuid",
  "phase": "uploading_ipfs",
  "progress": {
    "cloning": { "total": 47, "completed": 47, "status": "done" },
    "merkle": { "status": "done" },
    "ipfs": { "total": 47, "completed": 32, "status": "in_progress" },
    "ckb": { "status": "waiting" }
  },
  "overallPercent": 67
}
```

---

### Verification

#### `GET /verify/:ckbTxHash`

Verify a backup against its CKB anchor.

**Auth required:** No

**Response:**
```json
{
  "isValid": true,
  "onChainMerkleRoot": "0x7a8b3c...",
  "computedMerkleRoot": "0x7a8b3c...",
  "timestamp": 1726678590,
  "blockNumber": 12345678,
  "explorerUrl": "https://explorer.nervos.org/transaction/0xdef456...",
  "backup": {
    "repoCount": 47,
    "commitCount": 3241,
    "ipfsCid": "bafybeig...",
    "createdAt": "2026-09-18T16:00:00Z"
  }
}
```

---

### Restore

#### `POST /restore`

Trigger a restore operation.

**Auth required:** Yes

**Request:**
```json
{
  "backupId": "uuid",
  "targetPlatform": "github",
  "targetUsername": "new-jedi",
  "targetEmail": "new@email.com",
  "repoIds": ["uuid1", "uuid2"],
  "includeAll": true
}
```

**Response:**
```json
{
  "restoreId": "uuid",
  "status": "pending",
  "reposTotal": 47,
  "createdAt": "2026-09-18T17:00:00Z"
}
```

---

#### `GET /restore/:restoreId/progress`

Get real-time restore progress.

**Auth required:** Yes

**Response:**
```json
{
  "restoreId": "uuid",
  "status": "restoring",
  "reposTotal": 47,
  "reposCompleted": 12,
  "currentRepo": "web-app",
  "repos": [
    { "name": "my-project", "status": "completed", "commits": 847 },
    { "name": "web-app", "status": "pushing", "commits": 234, "progress": 67 }
  ]
}
```

---

### Passport

#### `POST /passport/mint`

Mint a Sovereign Passport DOB.

**Auth required:** Yes

**Response:**
```json
{
  "txHash": "0xabc...",
  "status": "pending",
  "passport": {
    "totalRepos": 47,
    "totalCommits": 3241,
    "firstCommitDate": "2019-03-15",
    "lastBackupDate": "2026-09-18",
    "languages": ["TypeScript", "Rust", "Python"]
  }
}
```

---

#### `GET /passport/:ckbAddress`

Get a user's Sovereign Passport data.

**Auth required:** No

**Response:**
```json
{
  "identity": {
    "ckbAddress": "ckb1q...abc",
    "displayName": "jedi",
    "githubUsernameHash": "sha256('jedi')",
    "createdAt": 1726678590
  },
  "stats": {
    "totalRepos": 47,
    "totalCommits": 3241,
    "firstCommitDate": "2019-03-15",
    "lastBackupDate": "2026-09-18",
    "languages": ["TypeScript", "Rust", "Python"]
  },
  "backups": [
    {
      "timestampTx": "0xabc...",
      "merkleRoot": "0x7a8b3c...",
      "ipfsCid": "bafybeig...",
      "repoCount": 47,
      "date": "2026-09-18"
    }
  ],
  "verified": true,
  "txHash": "0xdef..."
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "Repository not found",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `AUTH_REQUIRED` | 401 | No valid JWT token provided |
| `AUTH_INVALID_SIGNATURE` | 401 | Wallet signature verification failed |
| `AUTH_CHALLENGE_EXPIRED` | 401 | Challenge nonce has expired |
| `FORBIDDEN` | 403 | User doesn't have access to this resource |
| `USER_NOT_FOUND` | 404 | User does not exist |
| `REPO_NOT_FOUND` | 404 | Repository does not exist |
| `BACKUP_NOT_FOUND` | 404 | Backup does not exist |
| `BACKUP_IN_PROGRESS` | 409 | A backup is already running |
| `GITHUB_NOT_LINKED` | 422 | GitHub account not linked yet |
| `INSUFFICIENT_CKB` | 422 | Not enough CKB balance for transaction |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Internal server error |

---

## Rate Limits

| Endpoint Category | Limit | Window |
|---|---|---|
| Auth | 10 requests | 1 minute |
| Read (repos, files, commits) | 100 requests | 1 minute |
| Write (backups, restore) | 5 requests | 1 minute |
| Public (profiles, verify) | 60 requests | 1 minute |

---

## WebSocket Events

Connect to `wss://api.rivet.dev/ws` with JWT token for real-time updates.

### Events

| Event | Direction | Description |
|---|---|---|
| `backup:progress` | Server → Client | Backup progress update |
| `backup:complete` | Server → Client | Backup finished |
| `backup:error` | Server → Client | Backup failed |
| `restore:progress` | Server → Client | Restore progress update |
| `restore:complete` | Server → Client | Restore finished |
| `ckb:confirmed` | Server → Client | CKB transaction confirmed |
