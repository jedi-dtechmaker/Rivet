ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "githubNumericId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Repository_githubNumericId_key" ON "Repository"("githubNumericId");

CREATE TABLE IF NOT EXISTS "PublicationStream" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "cotaScriptHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "headOutpoint" TEXT,
  "reservationId" TEXT,
  "reservedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationStream_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PublicationStream_network_cotaScriptHash_key" ON "PublicationStream"("network", "cotaScriptHash");
CREATE UNIQUE INDEX IF NOT EXISTS "PublicationStream_reservationId_key" ON "PublicationStream"("reservationId");

CREATE TABLE IF NOT EXISTS "CotaManifestOperation" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "streamId" TEXT NOT NULL,
  "protocol" TEXT NOT NULL DEFAULT 'cota-manifest-v1',
  "kind" TEXT NOT NULL,
  "sourceOutpoint" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "unsignedTransaction" JSONB,
  "serializedUnsignedTransaction" TEXT,
  "planDigest" TEXT,
  "plan" JSONB,
  "root" TEXT,
  "previousRoot" TEXT,
  "txHash" TEXT,
  "status" TEXT NOT NULL,
  "acceptedAttemptId" TEXT,
  "confirmedTransaction" JSONB,
  "diagnostics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CotaManifestOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CotaManifestOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CotaManifestOperation_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "PublicationStream"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CotaManifestOperation_acceptedAttemptId_key" ON "CotaManifestOperation"("acceptedAttemptId");
CREATE INDEX IF NOT EXISTS "CotaManifestOperation_userId_createdAt_idx" ON "CotaManifestOperation"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CotaManifestOperation_streamId_createdAt_idx" ON "CotaManifestOperation"("streamId", "createdAt");
-- Prisma cannot declare partial indexes. This also enforces the cross-protocol
-- pending-plan invariant when callers use the same actual-cell stream identity.
CREATE UNIQUE INDEX IF NOT EXISTS "CotaManifestOperation_one_pending_per_stream" ON "CotaManifestOperation"("streamId") WHERE "status" IN ('building', 'awaiting_signature', 'validating', 'signed_ready', 'broadcasting', 'submitted', 'unknown');

CREATE TABLE IF NOT EXISTS "CotaManifestSignedAttempt" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "signedTransaction" JSONB NOT NULL,
  "serializedTransaction" TEXT NOT NULL,
  "txHash" TEXT NOT NULL,
  "preflight" TEXT NOT NULL DEFAULT 'pending',
  "diagnostics" JSONB,
  "status" TEXT NOT NULL DEFAULT 'validating',
  "firstBroadcastAt" TIMESTAMP(3),
  "lastBroadcastAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CotaManifestSignedAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CotaManifestSignedAttempt_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "CotaManifestOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CotaManifestSignedAttempt_operationId_digest_key" ON "CotaManifestSignedAttempt"("operationId", "digest");
CREATE INDEX IF NOT EXISTS "CotaManifestSignedAttempt_operationId_createdAt_idx" ON "CotaManifestSignedAttempt"("operationId", "createdAt");

CREATE TABLE IF NOT EXISTS "CotaManifestEnrollment" (
  "userId" TEXT NOT NULL,
  "ownerLockHash" TEXT NOT NULL,
  "issuerLockHash" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "tokenIndexes" JSONB NOT NULL,
  "issuanceOperationId" TEXT,
  "issuanceTxHash" TEXT,
  "initialManifest" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "claimTxHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CotaManifestEnrollment_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "CotaManifestEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CotaManifestEnrollment_issuanceOperationId_key" ON "CotaManifestEnrollment"("issuanceOperationId");
