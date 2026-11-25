CREATE TABLE IF NOT EXISTS "RivetAnalyticsActivity" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "lastSignInAt" TIMESTAMP(3),
  "signInCount" INTEGER NOT NULL DEFAULT 0,
  "firstDashboardAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "returned" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS "RivetAnalyticsPageView" (
  "day" DATE NOT NULL,
  "page" TEXT NOT NULL,
  "views" BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("day", "page")
);
