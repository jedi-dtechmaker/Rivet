import { prisma } from '@/lib/db';
import type { TrackedPage } from '@/lib/analytics-policy';

export function analyticsEnabled() {
  return process.env.RIVET_ANALYTICS_ENABLED === 'true';
}

export async function recordSignIn(userId: string) {
  if (!analyticsEnabled()) return;
  try {
    await prisma.$executeRaw`
      INSERT INTO "RivetAnalyticsActivity" ("userId", "lastSignInAt", "signInCount")
      VALUES (${userId}, NOW() AT TIME ZONE 'UTC', 1)
      ON CONFLICT ("userId") DO UPDATE SET
        "lastSignInAt" = NOW() AT TIME ZONE 'UTC', "signInCount" = "RivetAnalyticsActivity"."signInCount" + 1,
        "returned" = "RivetAnalyticsActivity"."returned" OR "RivetAnalyticsActivity"."firstSeenAt"::date < (NOW() AT TIME ZONE 'UTC')::date,
        "lastSeenAt" = NOW() AT TIME ZONE 'UTC'`;
  } catch {
    console.error('[analytics] Could not record sign-in. Check the analytics setup.');
  }
}

export async function recordPageView(page: TrackedPage, githubId?: string) {
  if (!analyticsEnabled()) return;
  await prisma.$executeRaw`
    INSERT INTO "RivetAnalyticsPageView" ("day", "page", "views")
    VALUES ((NOW() AT TIME ZONE 'UTC')::date, ${page}, 1)
    ON CONFLICT ("day", "page") DO UPDATE SET "views" = "RivetAnalyticsPageView"."views" + 1`;
  if (page === 'dashboard' && githubId) {
    await prisma.$executeRaw`
      INSERT INTO "RivetAnalyticsActivity" ("userId", "firstDashboardAt")
      SELECT "id", NOW() AT TIME ZONE 'UTC' FROM "User" WHERE "githubId" = ${githubId}
      ON CONFLICT ("userId") DO UPDATE SET
        "firstDashboardAt" = COALESCE("RivetAnalyticsActivity"."firstDashboardAt", NOW() AT TIME ZONE 'UTC'),
        "returned" = "RivetAnalyticsActivity"."returned" OR "RivetAnalyticsActivity"."firstSeenAt"::date < (NOW() AT TIME ZONE 'UTC')::date,
        "lastSeenAt" = NOW() AT TIME ZONE 'UTC'`;
  }
}
