CREATE TABLE "VellumDidChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "did" TEXT NOT NULL,
  "controllerLockHash" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VellumDidChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VellumDidChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VellumDidChallenge_userId_key" ON "VellumDidChallenge"("userId");

CREATE TABLE "VellumIdentityBinding" (
  "userId" TEXT NOT NULL,
  "did" TEXT NOT NULL,
  "controllerLockHash" TEXT NOT NULL,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VellumIdentityBinding_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "VellumIdentityBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VellumIdentityBinding_did_key" ON "VellumIdentityBinding"("did");

CREATE TABLE "VellumBackupClaim" (
  "repositoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectDid" TEXT NOT NULL,
  "issuerDid" TEXT NOT NULL,
  "schemaHash" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'preparing',
  "leaseToken" TEXT,
  "claimId" TEXT,
  "outputIndex" INTEGER,
  "signedTransaction" TEXT,
  "transactionHash" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VellumBackupClaim_pkey" PRIMARY KEY ("repositoryId"),
  CONSTRAINT "VellumBackupClaim_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VellumBackupClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VellumBackupClaim_status_check" CHECK ("status" IN ('preparing', 'prepared', 'submitted', 'confirmed', 'review_required')),
  CONSTRAINT "VellumBackupClaim_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "VellumBackupClaim_nonce_check" CHECK ("nonce" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "VellumBackupClaim_prepared_check" CHECK ("status" IN ('preparing', 'review_required') OR ("claimId" IS NOT NULL AND "outputIndex" IS NOT NULL AND "outputIndex" >= 0 AND "signedTransaction" IS NOT NULL AND "transactionHash" IS NOT NULL)),
  CONSTRAINT "VellumBackupClaim_confirmed_check" CHECK (("status" = 'confirmed' AND "confirmedAt" IS NOT NULL) OR ("status" <> 'confirmed' AND "confirmedAt" IS NULL))
);

CREATE UNIQUE INDEX "VellumBackupClaim_claimId_key" ON "VellumBackupClaim"("claimId");
CREATE UNIQUE INDEX "VellumBackupClaim_transactionHash_key" ON "VellumBackupClaim"("transactionHash");
CREATE INDEX "VellumBackupClaim_status_updatedAt_idx" ON "VellumBackupClaim"("status", "updatedAt");
CREATE INDEX "VellumBackupClaim_subjectDid_idx" ON "VellumBackupClaim"("subjectDid");

CREATE TABLE "VellumIssuerLease" (
  "key" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "repositoryId" TEXT,
  "transactionHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VellumIssuerLease_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "VellumIssuerLease_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "VellumIssuerLease_repositoryId_key" ON "VellumIssuerLease"("repositoryId");
