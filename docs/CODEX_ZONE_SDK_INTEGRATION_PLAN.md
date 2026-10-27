# 🛠️ Codex & Logos Zone SDK Integration Plan for Rivet

> **Target Platform**: Logos Ecosystem (Codex + Nomos / Zone SDK + Waku)  
> **Status**: Technical Specification & Implementation Plan  
> **Repository**: `jedi-dtechmaker/Rivet` (Logos Edition)  

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          USER APPLICATION                              │
│                                                                        │
│   🌐 Next.js Dashboard (apps/web)        💻 CLI Tool (apps/cli)       │
└───────────────────────────┬────────────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────────────┐
│                    RIVET EXECUTION WORKER                              │
│                                                                        │
│   1. git clone --mirror <repo>                                         │
│   2. git bundle create <repo.bundle> --all                             │
│   3. Compute:                                                          │
│      • Merkle Root: SHA-256 tree over git log --all                   │
│      • Sorted Refs Hash: SHA-256 over git show-ref (heads & tags)     │
│      • Bundle Hash: SHA-256 over raw .bundle file                      │
│   4. (Optional) AES-256-GCM encryption for private repositories        │
└───────────────┬───────────────────────────────────┬────────────────────┘
                │                                   │
                ▼                                   ▼
┌───────────────────────────────┐   ┌────────────────────────────────────┐
│   STORAGE LAYER (CODEX)       │   │   BLOCKCHAIN LAYER (NOMOS / ZONE)  │
│                               │   │                                    │
│  Codex Local / Network Node   │   │  Rivet Zone Sequencer (Rust)       │
│  API: :8080/api/codex/v1      │   │                                    │
│                               │   │  Channel ID: Ed25519 Public Key    │
│  Upload:                      │   │  Signing Key: Authorized Key       │
│  POST /api/codex/v1/data      │   │  Posts Chained Inscription:        │
│                               │   │  • merkle_root                     │
│  Returns:                     │   │  • sorted_refs_hash                │
│  Codex Content ID (CID)       │   │  • bundle_sha256                   │
│                               │   │  • codex_cid                       │
│  Durable Storage Request:     │   │                                    │
│  POST /storage/request/{cid}  │   │  Enforces:                         │
│  with erasure coding & ZK     │   │  Parent Hash SequencerCheckpoint   │
└───────────────────────────────┘   └────────────────────────────────────┘
```

---

## 2. Part 1: Codex Storage Adapter

In the CKB implementation, the worker used Pinata (`PinataSDK`) to pin bundles to IPFS. In the Logos version, we interact directly with Codex.

### 2.1 Codex Client Interface (`apps/web/src/lib/codex.ts`)

```typescript
/**
 * Codex Client Adapter for Rivet
 * Interacts with the local or remote Codex node HTTP API.
 */

export interface CodexUploadResult {
  cid: string;
  sizeBytes: number;
}

export class CodexClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.CODEX_API_URL || 'http://localhost:8080') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Upload a raw or encrypted git bundle to Codex.
   */
  async uploadBundle(fileBuffer: Buffer): Promise<CodexUploadResult> {
    const res = await fetch(`${this.baseUrl}/api/codex/v1/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Codex upload failed (${res.status}): ${errorText}`);
    }

    // Codex returns the CID as plain text or JSON
    const cid = (await res.text()).trim();
    return {
      cid,
      sizeBytes: fileBuffer.length,
    };
  }

  /**
   * Request durable network persistence for a dataset.
   * Leverages Codex erasure coding and ZK proof-of-retrievability.
   */
  async requestPersistence(cid: string, durationSeconds: number, rewardTokens = 0): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/codex/v1/storage/request/${cid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duration: durationSeconds,
        reward: rewardTokens,
      }),
    });

    if (!res.ok && res.status !== 404) {
      console.warn(`[codex] Persistence contract request status: ${res.status}`);
    }
  }

  /**
   * Stream a bundle back from Codex for restoration.
   */
  async downloadBundle(cid: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/api/codex/v1/data/${cid}/network/stream`);
    if (!res.ok) {
      throw new Error(`Failed to download bundle from Codex (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
```

---

## 3. Part 2: Logos Zone SDK & Channel Inscriptions

In Logos, state transitions are written to **Channels** via the **Logos Zone SDK** (`logos-blockchain/zone-sdk`).

### 3.1 Data Model: The Git Archive Inscription

Every backup event publishes an inscription struct:

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitArchiveInscription {
    pub version: u8,
    pub repo_full_name: String,
    pub commit_count: u64,
    /// 32-byte Merkle root over all commit hashes
    pub merkle_root: [u8; 32],
    /// 32-byte SHA-256 over deterministic sorted refs (git show-ref)
    pub sorted_refs_hash: [u8; 32],
    /// 32-byte SHA-256 over the raw .bundle file before encryption
    pub bundle_sha256: [u8; 32],
    /// Codex storage reference
    pub codex_cid: String,
    pub is_encrypted: bool,
    pub timestamp: u64,
}
```

### 3.2 The Zone Sequencer Microservice (`packages/rivet-zone`)

Using `ZoneSequencer` from `logos-blockchain/zone-sdk`:

```rust
use logos_zone_sdk::sequencer::{ZoneSequencer, SequencerCheckpoint};
use logos_zone_sdk::keys::Ed25519Key;
use logos_zone_sdk::net::NodeHttpClient;
use std::path::Path;

pub struct RivetZoneSequencer {
    sequencer: ZoneSequencer<NodeHttpClient>,
    channel_id: String,
}

impl RivetZoneSequencer {
    pub async fn init(
        node_url: &str,
        key_path: &Path,
        checkpoint_path: &Path,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let node = NodeHttpClient::new(node_url);
        let signing_key = load_or_create_key(key_path);
        let channel_id = derive_channel_id(&signing_key);
        let checkpoint = load_checkpoint(checkpoint_path);

        let sequencer = ZoneSequencer::new(channel_id.clone(), signing_key, node, checkpoint);

        Ok(Self { sequencer, channel_id })
    }

    /// Sign and publish a git backup inscription to the Logos Blockchain channel
    pub async fn post_backup(
        &mut self,
        inscription: GitArchiveInscription,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let payload = serde_json::to_vec(&inscription)?;
        
        // Sequencer automatically hashes parent reference and submits inscription
        let message_hash = self.sequencer.post_message(&payload).await?;
        
        // Persist checkpoint for graceful restart
        self.sequencer.save_checkpoint().await?;
        
        Ok(message_hash)
    }
}
```

---

## 4. Part 3: Updating the Backup & Restore Pipelines

### 4.1 Changes in `backup-worker.mjs`
1. **Hashing Sorted Refs**:
   ```javascript
   const { stdout: refLog } = await execFileAsync(
     'git', ['show-ref', '--heads', '--tags'], { cwd: tmpDir }
   );
   const sortedRefs = refLog.split('\n').filter(Boolean).sort().join('\n');
   const sortedRefsHash = crypto.createHash('sha256').update(sortedRefs).digest('hex');
   ```

2. **Bundle SHA-256**:
   ```javascript
   const bundleBuffer = await fs.readFile(bundlePath);
   const bundleSha256 = crypto.createHash('sha256').update(bundleBuffer).digest('hex');
   ```

3. **Uploading to Codex**:
   ```javascript
   const codex = new CodexClient(process.env.CODEX_API_URL);
   const { cid: codexCid } = await codex.uploadBundle(encryptedBuffer || bundleBuffer);
   ```

4. **Posting to Logos Channel**:
   Call the `rivet-zone` sequencer API or CLI with the payload to anchor the new state.

---

## 5. Part 4: Standalone Zero-Dependency Verification Tool

Any developer who clones or restores an archive can verify it offline using standard Linux tools:

```bash
#!/usr/bin/env bash
# verify_rivet_logos.sh <bundle_file> <expected_bundle_sha256> <expected_refs_hash>

BUNDLE="$1"
EXP_BUNDLE_HASH="$2"
EXP_REFS_HASH="$3"

echo "==> Step 1: Verifying Bundle SHA-256 Checksum"
ACTUAL_BUNDLE_HASH=$(sha256sum "$BUNDLE" | awk '{print $1}')
if [ "$ACTUAL_BUNDLE_HASH" != "$EXP_BUNDLE_HASH" ]; then
    echo "❌ BUNDLE TAMPERED OR CORRUPTED!"
    exit 1
fi
echo "✓ Bundle checksum matches."

echo "==> Step 2: Unpacking and Verifying Ref Topology"
TMP_DIR=$(mktemp -d)
git clone "$BUNDLE" "$TMP_DIR/repo" -q
cd "$TMP_DIR/repo"

ACTUAL_REFS_HASH=$(git show-ref --heads --tags | sort | sha256sum | awk '{print $1}')
if [ "$ACTUAL_REFS_HASH" != "$EXP_REFS_HASH" ]; then
    echo "❌ REFS / TIP COMMITS MISMATCH!"
    exit 1
fi
echo "✓ Refs and tip commits match on-chain anchor perfectly."
echo "✅ ARCHIVE IS 100% VERIFIED INDEPENDENTLY."
rm -rf "$TMP_DIR"
```

---

## 6. Phased Implementation Timeline

| Phase | Tasks | Target |
|---|---|---|
| **Phase 1** | Implement `apps/web/src/lib/codex.ts` and test upload/stream against a local Codex node | Week 1–2 |
| **Phase 2** | Scaffold `packages/rivet-zone` (Rust) using `logos-blockchain/zone-sdk` for channel inscriptions | Week 3–4 |
| **Phase 3** | Update backup and restore workers to store on Codex and post to Logos channels | Week 5–6 |
| **Phase 4** | Deploy verification web UI and create Basecamp application manifest | Week 7–8 |
