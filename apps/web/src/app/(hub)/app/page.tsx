import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  getAdminActivity,
  getAdminAudit,
  getAiHealth,
  getHeldPosts,
  getAdminDashboard,
  getAdminDashboardGated,
  getMe,
  getSupportConsole,
  getSupportConsoleGated,
  type AdminActivityRow,
} from '../../../lib/api';
import { StepUp } from './step-up';
import { NoAccess, AdminUnavailable } from './no-access';
import { AuditFilters } from './audit-filters';
import { Dashboard } from './dashboard';
import { PageHeader, Section, StatGrid, StatTile } from '../../../components/hub-page';
import { PageTabs, resolveTab, type PageTab } from '../../../components/page-tabs';
import { MonthTabs } from './month-tabs';
import { PromotionRun } from './promotion-run';
import { Moderation } from './moderation';
import { Support } from './support';
import { SupportTabBadge } from './support-tab-badge';
import { ActivityTable } from './activity-table';
import { LiveRefresh } from '../../../components/live-refresh';

/**
 * The admin console (P1.7).
 *
 * Lives at /app on the apex rather than a subdomain, per the decision taken
 * with the human: sslip.io does support subdomains, but a separate origin means
 * a separate cookie scope and a second TLS name for no benefit at this size.
 *
 * The API refuses these reads without a fresh second factor, so a null response
 * means "step up", not "something broke". A locked door should look like a
 * locked door.
 */
export const metadata: Metadata = {
  title: "Admin — Grim's Squad",
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * ★ FOUR VIEWS OF ONE CONSOLE ★
 *
 * The dashboard is the DEFAULT because it is the only one that answers "how is
 * the squadron doing" without reading a table. The other three are the tables,
 * and somebody who wants a table knows which one they want.
 *
 * Roles & permissions is a link rather than a tab: it lives at its own route
 * with its own editing surface, and pretending a separate page is a tab of this
 * one would break the back button in a way that costs an officer their work.
 *
 * Each tab fetches only what it renders. The dashboard's aggregates and the
 * audit log's hundred rows have no reason to be read on the same request.
 */
const TABS: readonly PageTab[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'activity', label: 'Member activity & promotions' },
  { key: 'audit', label: 'Audit log' },
  /*
   * ★ ADDED WHEN SCREENING SHIPPED, AND IT HAD TO ★
   *
   * The screener already holds posts it objects to. Without a screen to release or refuse them
   * they accumulate where nobody can see, while their authors are told an officer will look and
   * no officer can — which is worse than having no screening at all.
   */
  { key: 'moderation', label: 'Moderation' },
  /*
   * ★ THE HELP DESK'S ANSWERING SIDE ★
   *
   * The chat widget promises every visitor — guests included — that the officers answer.
   * This tab is where that promise is kept. Gated on SUPPORT_AGENT rather than the console's
   * MEMBER_MANAGE, because answering questions and managing members are different jobs.
   */
  { key: 'support', label: 'Support' },
  { key: 'roles', label: 'Roles & permissions' },
];


export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(TABS, params['tab']);
  /*
   * `YYYY-MM`, or absent for the current month. Validated server-side (parseMonth) — anything
   * unparseable falls back to today rather than erroring, so a stale link shows a page.
   */
  const monthParam = typeof params['month'] === 'string' ? params['month'] : undefined;

  /*
   * Roles lives at its own route. Handled as a redirect rather than rendered
   * here so the tab is a real destination and the URL is honest about where
   * you are.
   */
  if (tab === 'roles') redirect('/app/roles');

  /*
   * Only what this tab shows. The gate check has to come from SOMETHING
   * though — every tab needs to know whether the second factor is fresh, and
   * a null from any admin read is that answer.
   */
  const [dashboard, activity, audit, held, aiHealth, support, me] = await Promise.all([
    /*
     * Fetched for the ACTIVITY tab too, and only for its `availableMonths`.
     *
     * The month list lives in the dashboard response because that is where the activity table is
     * summarised. Duplicating the query onto the activity endpoint would be a second place for the
     * same list to be computed differently.
     */
    tab === 'dashboard' || tab === 'activity'
      ? getAdminDashboard(monthParam)
      : Promise.resolve(null),
    tab === 'activity' ? getAdminActivity(monthParam) : Promise.resolve(null),
    tab === 'audit' ? getAdminAudit() : Promise.resolve(null),
    tab === 'moderation' ? getHeldPosts() : Promise.resolve(null),
    /*
     * Health is fetched alongside the queue rather than gating on it. A null here is not a locked
     * tab — it means the caller lacks AI_REVIEW for the health route specifically, or the API did
     * not answer — and neither is a reason to hide a queue that loaded fine.
     */
    tab === 'moderation' ? getAiHealth() : Promise.resolve(null),
    tab === 'support' ? getSupportConsole('open') : Promise.resolve(null),
    /*
     * For the support tab's clock only. INV-025 wants the queue's absolute times in the
     * OFFICER's stored timezone, and that zone lives on /v1/me.
     */
    tab === 'support' ? getMe() : Promise.resolve(null),
  ]);

  /*
   * ★ WHY THE REASON IS PROBED SEPARATELY ★
   *
   * This used to be `locked = (data === null)` for whichever tab was showing, and every
   * `locked` rendered the two-factor challenge. `null` covers three unrelated situations —
   * not stepped up, not permitted, and the API being unreachable — and only the first is
   * fixable with a code.
   *
   * On 2026-07-30 that sent an officer without MEMBER_MANAGE into an endless code prompt
   * whose codes were all accepted. So when a tab's read comes back empty, one cheap gated
   * request establishes WHY before choosing a screen.
   *
   * The extra request only happens on the failure path, so the ordinary case pays nothing.
   */
  const locked =
    (tab === 'dashboard' && dashboard === null) ||
    (tab === 'activity' && activity === null) ||
    (tab === 'audit' && audit === null) ||
    (tab === 'moderation' && held === null) ||
    (tab === 'support' && support === null);

  if (locked) {
    /*
     * The support tab probes ITS OWN gate. Its bit is SUPPORT_AGENT, not MEMBER_MANAGE, and a
     * probe against the dashboard would tell a future support-only role to ask for the wrong
     * permission.
     */
    const why =
      tab === 'support' ? await getSupportConsoleGated() : await getAdminDashboardGated(monthParam);
    if (why.state === 'forbidden') {
      return tab === 'support' ? (
        <NoAccess what="the support console" permission="SUPPORT_AGENT" />
      ) : (
        <NoAccess what="the admin console" permission="MEMBER_MANAGE" />
      );
    }
    if (why.state === 'unavailable') return <AdminUnavailable />;
    // 'needs-step-up', 'signed-out', or the probe succeeding while the tab's own read did
    // not — a code is the reasonable thing to ask for.
    return <StepUp />;
  }

  return (
    <>
      {/*
        ★ THE CONSOLE UPDATES ITSELF ★

        Squadron owner, 2026-07-29: verifications must show instantly across the
        app. This is the page an officer sits on while somebody else links their
        Inara key — the CMDR verified column was going stale the moment it
        rendered, and the only way to see the change was to reload.

        `roster` is the squadron-wide event a verification publishes; `activity`
        and `presence` cover the rest of what this table shows. `verification`
        is here for the officer's OWN state, which is member-scoped.
      */}
      <LiveRefresh types={['roster', 'verification', 'activity', 'presence']} />

      <PageHeader
        eyebrow="Squadron leadership"
        title="ADMIN CONSOLE"
        tabs={
          <PageTabs
            /*
             * The Support tab wears the waiting count ON ITS LABEL — officers get no
             * per-message notifications, so this pill is their entire bell, and it has to be
             * audible from every tab of the console. Attached at render rather than stored in
             * TABS, which stays a plain serialisable list.
             */
            tabs={TABS.map((t) =>
              t.key === 'support' ? { ...t, badge: <SupportTabBadge /> } : t,
            )}
            current={tab}
            basePath="/app"
          />
        }
      />

      {tab === 'dashboard' && dashboard !== null && (
        <>
          <MonthTabs
            months={dashboard.availableMonths}
            current={dashboard.month}
            basePath="/app"
            tab="dashboard"
          />
          {/*
            ★ NO SECOND REFRESHER HERE ★
            The page already carries `<LiveRefresh types={['roster','verification','activity',
            'presence']} />` above — an SSE-driven refresh that fires when activity is actually
            recorded, which is strictly better than a timer. Adding a thirty-second poll beside it
            would mean two mechanisms racing to re-render the same page.
          */}
          <Dashboard data={dashboard} />
        </>
      )}

      {tab === 'activity' && activity !== null && (
        <>
          {/*
            Member activity and promotion standing are BOTH monthly by nature — qualification is a
            statement about a calendar month — so history matters here more than anywhere. The month
            list is read from the dashboard's response when we have it, and falls back to the
            activity response's own month so the tabs still render on a direct link.
          */}
          <MonthTabs
            months={dashboard?.availableMonths ?? [activity.month]}
            current={activity.month}
            basePath="/app"
            tab="activity"
          />
          {/*
            Directly under the month tabs, because it acts on the month they name. Above the table
            rather than below it: the table is what you read, this is what you do about it.
          */}
          <PromotionRun month={activity.month} />
          <ActivityTab activity={activity} />
        </>
      )}

      {tab === 'audit' && audit !== null && (
        <Section
          title="Audit log"
          description="Read-only here and append-only in the database. A console that can edit the audit log is an audit log that proves nothing."
        >
          <AuditFilters
            initial={audit.entries}
            actions={audit.actions}
            initialTotal={audit.total}
          />
        </Section>
      )}

      {tab === 'moderation' && held !== null && (
        <Section
          title="Moderation"
          description="Posts the screener held before anybody could read them. Nothing here is public — releasing a post is what publishes it."
        >
          <Moderation initial={held.posts} total={held.total} health={aiHealth} />
        </Section>
      )}

      {tab === 'support' && support !== null && (
        <Section
          title="Support"
          description="Every help conversation, member or guest, lands here. Replies go out under your own name and avatar — the person asking sees exactly who answered."
        >
          <Support
            initial={support.conversations}
            viewerTz={me?.user?.timezone ?? 'UTC'}
          />
        </Section>
      )}
    </>
  );
}

function ActivityTab({
  activity,
}: {
  activity: { month: string; rows: AdminActivityRow[] };
}) {
  const qualifying = activity.rows.filter((r) => r.qualifies).length;
  const observed = activity.rows.filter((r) => r.gameActivity === 'observed').length;
  const linked = activity.rows.filter((r) => r.handle !== null).length;

  return (
    <>

      {/*
        Figures first, table beneath, both full width.

        This page's subject is a WIDE TABLE, so it gets no context rail — an
        activity roster squeezed into two-thirds to make room for one would be a
        worse page, not a fuller one. The band across the top is what fills the
        width here, and it answers the questions an officer opens this page with
        before they read a single row.
      */}
      <StatGrid>
        <StatTile
          label="Qualifying"
          value={String(qualifying)}
          hint={`of ${activity.rows.length} tracked, ${activity.month}`}
          tone="accent"
        />
        <StatTile
          label="Elite session seen"
          value={String(observed)}
          hint={observed === 0 ? 'Nothing has reported a session yet' : 'Confirmed from journals'}
          tone={observed === 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Linked accounts"
          value={String(linked)}
          hint="Have signed in to the hub"
        />
        <StatTile
          label="Tracked"
          value={String(activity.rows.length)}
          hint="Members the bot has seen this month"
        />
      </StatGrid>

      <Section
        title={`Activity — ${activity.month}`}
        /*
          ★ SQUADRON OWNER, 2026-08-01 ★

          "make this read alot better, right now it reads like a developer note ... nothing should
          be there about a dry run or the first promotion etc."

          Quite right. It opened with a reset time and a boolean, then spent its last sentence on
          our release plan — three facts about how the system works and none about the squadron.

          What an officer needs from a subtitle is what earns a month and what the colours mean.
          Both are said plainly, in the order they will be read. The green and red are described
          because they are the fastest thing on the page and are otherwise unexplained.
        */
        description="A member earns the month by talking in Discord and flying in Elite — both, not either. Green rows have earned it. Red rows have gone quiet for three months or more and are worth a message. Everything resets at midnight UTC on the 1st."
      >
        {/*
          ★ THE TABLE IS A CLIENT COMPONENT NOW ★

          Squadron owner, 2026-08-01: "we need to make these pages columns filterable". Filtering a
          hundred and seventeen rows already on the page is instant in the browser and a round trip
          on the server — and a navigation per keystroke on the name box would be visibly worse for
          the filter most likely to be typed into.

          `now` is passed rather than read inside it. Two of its columns are relative to the present,
          and a client component is still rendered on the server first, so `Date.now()` in there
          would produce one answer in the HTML and another at hydration.
        */}
        <ActivityTable rows={activity.rows} now={Date.now()} />
      </Section>

    </>
  );
}
