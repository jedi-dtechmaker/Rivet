CREATE TABLE IF NOT EXISTS "SovereignPassport" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT,
  "buildToken" TEXT,
  "ownerAddress" TEXT NOT NULL, "ownerLockHash" TEXT NOT NULL,
  "manifestRoot" TEXT NOT NULL, "manifestProof" JSONB NOT NULL,
  "content" TEXT NOT NULL, "sporeId" TEXT UNIQUE, "txHash" TEXT UNIQUE,
  "unsignedTransaction" JSONB, "signedTransaction" JSONB,
  "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
