CREATE TABLE IF NOT EXISTS "CotaUpdate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceOutpoint" TEXT NOT NULL,
  "txHash" TEXT NOT NULL,
  "root" TEXT NOT NULL,
  "previousRoot" TEXT NOT NULL,
  "records" JSONB NOT NULL,
  "leaves" JSONB NOT NULL,
  "unsignedTransaction" JSONB NOT NULL,
  "signedTransaction" JSONB,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CotaUpdate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CotaUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "CotaUpdate" ADD COLUMN IF NOT EXISTS "protocol" TEXT NOT NULL DEFAULT 'cota-smt-v1';
CREATE UNIQUE INDEX IF NOT EXISTS "CotaUpdate_userId_sourceOutpoint_protocol_key" ON "CotaUpdate"("userId", "sourceOutpoint", "protocol");
DROP INDEX IF EXISTS "CotaUpdate_userId_sourceOutpoint_key";
CREATE INDEX IF NOT EXISTS "CotaUpdate_userId_createdAt_idx" ON "CotaUpdate"("userId", "createdAt");
