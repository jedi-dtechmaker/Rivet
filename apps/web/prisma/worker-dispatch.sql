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
ALTER TABLE "WorkerDispatch" ADD COLUMN IF NOT EXISTS "repository" TEXT;
ALTER TABLE "WorkerDispatch" ADD COLUMN IF NOT EXISTS "previousOutpoint" TEXT;
ALTER TABLE "WorkerDispatch" ADD COLUMN IF NOT EXISTS "state" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "WorkerDispatch" ADD COLUMN IF NOT EXISTS "checkpoint" JSONB;
ALTER TABLE "WorkerDispatch" ADD COLUMN IF NOT EXISTS "dirty" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS "WorkerDispatch_repository_state_idx" ON "WorkerDispatch"("repository", "state");
CREATE TABLE IF NOT EXISTS "BackupDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "repository" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
