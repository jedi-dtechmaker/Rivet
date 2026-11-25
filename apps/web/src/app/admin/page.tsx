import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { analyticsEnabled } from '@/lib/analytics';
import { isAdminGithubId } from '@/lib/analytics-policy';
import { prisma } from '@/lib/db';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Rivet admin', robots: { index: false, follow: false } };

type ActivitySummary = { dashboard: bigint; returning: bigint; active: bigint; noDashboard: bigint; noBackup: bigint; unfinishedBackup: bigint };
type PageSummary = { page: string; views: bigint };

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminGithubId(session?.user?.id, process.env.RIVET_ADMIN_GITHUB_IDS)) notFound();

  let counts: { users: number; newUsers: number; wallets: number; started: number; completed: number };
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [users, newUsers, wallets, started, completed] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.user.count({ where: { ckbAddressVerifiedAt: { not: null } } }),
      prisma.user.count({ where: { workerDispatches: { some: { kind: 'backup' } } } }),
      prisma.user.count({ where: { repositories: { some: { isBackedUp: true } } } }),
    ]);
    counts = { users, newUsers, wallets, started, completed };
  } catch {
    return <div className={styles.page}><h1>Analytics unavailable</h1><p>Could not read the database. Check the server configuration.</p></div>;
  }

  let activity: ActivitySummary | null = null;
  let pages: PageSummary[] = [];
  let trackingError = false;
  if (analyticsEnabled()) {
    try {
      const [summaries, views] = await Promise.all([
        prisma.$queryRaw<ActivitySummary[]>`
          SELECT COUNT(*) FILTER (WHERE activity."firstDashboardAt" IS NOT NULL) AS dashboard,
            COUNT(*) FILTER (WHERE activity."returned" AND activity."lastSeenAt" >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days') AS returning,
            COUNT(*) FILTER (WHERE activity."lastSeenAt" >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days') AS active,
            COUNT(*) FILTER (WHERE activity."firstSeenAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'
              AND activity."firstDashboardAt" IS NULL) AS "noDashboard",
            COUNT(*) FILTER (WHERE activity."firstSeenAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'
              AND NOT EXISTS (SELECT 1 FROM "WorkerDispatch" job WHERE job."userId" = activity."userId" AND job."kind" = 'backup')
              AND NOT EXISTS (SELECT 1 FROM "Repository" repo WHERE repo."userId" = activity."userId" AND repo."isBackedUp")) AS "noBackup",
            COUNT(*) FILTER (WHERE activity."firstSeenAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'
              AND EXISTS (SELECT 1 FROM "WorkerDispatch" job WHERE job."userId" = activity."userId" AND job."kind" = 'backup')
              AND NOT EXISTS (SELECT 1 FROM "Repository" repo WHERE repo."userId" = activity."userId" AND repo."isBackedUp")) AS "unfinishedBackup"
          FROM "RivetAnalyticsActivity" activity`,
        prisma.$queryRaw<PageSummary[]>`
          SELECT "page", SUM("views")::bigint AS views FROM "RivetAnalyticsPageView"
          WHERE "day" >= (NOW() AT TIME ZONE 'UTC')::date - 29 GROUP BY "page" ORDER BY views DESC`,
      ]);
      activity = summaries[0] ?? null;
      pages = views;
    } catch {
      trackingError = true;
    }
  }

  const metrics = [
    ['Registered GitHub accounts', counts.users],
    ['New accounts · last 30 days', counts.newUsers],
    ['Verified wallets', counts.wallets],
    ['Users who started a backup', counts.started],
    ['Users with a completed backup', counts.completed],
  ] as const;

  return (
    <div className={styles.page}>
      <h1>Rivet analytics</h1>
      <p className={styles.intro}>Private, aggregate counts for onboarding and usage.</p>
      <h2>Onboarding</h2>
      <div className={styles.grid}>
        {metrics.map(([label, value]) => <div className={styles.card} key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>)}
        {activity && <div className={styles.card}><span>Users who visited the dashboard</span><strong>{Number(activity.dashboard).toLocaleString()}</strong></div>}
      </div>
      <p className={styles.note}>A completed backup means an account has at least one repository marked backed up. These are current totals, not a cohort conversion rate. Wallet linking is optional.</p>
      {activity && <>
        <h2>Onboarding follow-through</h2>
        <div className={styles.grid}>
          <div className={styles.card}><span>No dashboard visit after 7 days</span><strong>{Number(activity.noDashboard).toLocaleString()}</strong></div>
          <div className={styles.card}><span>No backup started after 7 days</span><strong>{Number(activity.noBackup).toLocaleString()}</strong></div>
          <div className={styles.card}><span>Backup started but none completed after 7 days</span><strong>{Number(activity.unfinishedBackup).toLocaleString()}</strong></div>
        </div>
        <p className={styles.note}>These counts cover accounts first observed since tracking was enabled. They show current state after seven days, not proof someone abandoned onboarding; CLI activity and job retention can affect them.</p>
      </>}
      <h2>Usage · last 30 days</h2>
      {!analyticsEnabled() ? <p>Tracking is off. Set up the analytics tables and enable RIVET_ANALYTICS_ENABLED to collect usage from that point forward.</p>
        : trackingError ? <p>Usage data is unavailable. Check the analytics database setup.</p>
          : <>
            <div className={styles.grid}>
              <div className={styles.card}><span>Active accounts</span><strong>{Number(activity?.active ?? 0).toLocaleString()}</strong></div>
              <div className={styles.card}><span>Returning accounts</span><strong>{Number(activity?.returning ?? 0).toLocaleString()}</strong></div>
            </div>
            <p className={styles.note}>Active means a recorded GitHub sign-in or signed-in dashboard visit. Returning means activity on a later UTC day than the first recorded activity, with activity in the last 30 days. Existing sessions and activity before tracking was enabled are not counted.</p>
            <h3>Page views</h3>
            {pages.length ? <ul className={styles.pages}>{pages.map(page => <li key={page.page}><span>{page.page}</span><strong>{Number(page.views).toLocaleString()}</strong></li>)}</ul> : <p>No page views recorded yet.</p>}
            <p className={styles.note}>Page counts are aggregate views, not unique visitors. Only selected page categories are recorded; no URLs, IP addresses, or query strings are stored by this feature.</p>
          </>}
    </div>
  );
}
