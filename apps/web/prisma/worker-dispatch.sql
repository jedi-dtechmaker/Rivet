CREATE TABLE IF NOT EXISTS "WorkerDispatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerDispatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkerDispatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WorkerDispatch_userId_createdAt_idx" ON "WorkerDispatch"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkerDispatch_createdAt_idx" ON "WorkerDispatch"("createdAt");
