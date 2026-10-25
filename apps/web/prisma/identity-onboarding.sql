ALTER TABLE "User" ADD COLUMN "ckbAddressVerifiedAt" TIMESTAMP(3);

CREATE TABLE "WalletChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WalletChallenge_userId_key" ON "WalletChallenge"("userId");

CREATE TABLE "CotaRegistration" (
  "userId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "txHash" TEXT NOT NULL,
  "outputIndex" INTEGER NOT NULL,
  "transaction" JSONB,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CotaRegistration_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "CotaRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CotaRegistration_address_key" ON "CotaRegistration"("address");
CREATE UNIQUE INDEX "CotaRegistration_txHash_outputIndex_key" ON "CotaRegistration"("txHash", "outputIndex");
