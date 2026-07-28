import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  getAdminActivity,
  getAdminAudit,
  getAdminDashboard,
  type AdminActivityRow,
} from '../../../lib/api';
import { StepUp } from './step-up';
import { AuditFilters } from './audit-filters';
import { Dashboard } from './dashboard';
import { PageHeader, Section, StatGrid, StatTile } from '../../../components/hub-page';
import { PageTabs, resolveTab, type PageTab } from '../../../components/page-tabs';

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
  { key: 'roles', label: 'Roles & permissions' },
];

function Num({ n, dim = false }: { n: number; dim?: boolean }) {
  return (
    <span
      className={`font-mono ${n === 0 || dim ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'}`}
    >
      {n.toLocaleString('en-GB')}
    </span>
  );
}

const GAME_LABEL: Record<string, string> = {
  observed: 'Seen',
  // Shown distinctly from "Seen" on purpose. `assumed` means the upstream check
  // FAILED and we counted the month anyway (D26, fail open). An assumption must
  // never be presented to an officer as an observation.
  assumed: 'Assumed',
  absent: 'None',
  unlinked: 'No CMDR',
  unknown: 'Not checked',
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(TABS, params['tab']);

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
  const [dashboard, activity, audit] = await Promise.all([
    tab === 'dashboard' ? getAdminDashboard() : Promise.resolve(null),
    tab === 'activity' ? getAdminActivity() : Promise.resolve(null),
    tab === 'audit' ? getAdminAudit() : Promise.resolve(null),
  ]);

  // Whichever tab is showing, a null from its own read means the door is shut.
  const locked =
    (tab === 'dashboard' && dashboard === null) ||
    (tab === 'activity' && activity === null) ||
    (tab === 'audit' && audit === null);
  if (locked) return <StepUp />;

  return (
    <>
      <PageHeader
        eyebrow="Squadron leadership"
        title="ADMIN CONSOLE"
        action={<PageTabs tabs={TABS} current={tab} basePath="/app" />}
      />

      {tab === 'dashboard' && dashboard !== null && <Dashboard data={dashboard} />}

      {tab === 'activity' && activity !== null && <ActivityTab activity={activity} />}

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
        description="A month counts when there is any Discord activity AND an Elite session. Nothing is promoted before 1 August 2026, and the first live run will follow a dry run you have read."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-hairline)] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                <th scope="col" className="py-3 pr-4">Member</th>
                <th scope="col" className="py-3 pr-4">Rank</th>
                <th scope="col" className="py-3 pr-4">Working toward</th>
                <th scope="col" className="py-3 pr-4">Messages</th>
                <th scope="col" className="py-3 pr-4">Forum</th>
                <th scope="col" className="py-3 pr-4">Voice</th>
                <th scope="col" className="py-3 pr-4">Elite</th>
                <th scope="col" className="py-3">Qualifies</th>
              </tr>
            </thead>
            <tbody>
              {activity.rows.map((r) => (
                <tr key={r.discordId} className="border-b border-[var(--color-border-hairline)]">
                  <td className="py-3 pr-4 text-[var(--color-text-primary)]">
                    {r.displayName ?? r.handle ?? (
                      <span className="text-[var(--color-text-secondary)]">
                        Discord only ({r.discordId})
                      </span>
                    )}
                  </td>
                  {/*
                    The rank they hold, then the rung above it. Both on the
                    member line because "is this person due a promotion" is the
                    question this table exists to answer, and it cannot be
                    answered by activity counts alone.
                  */}
                  <td className="py-3 pr-4 font-mono text-xs text-[var(--color-brand-cyan-bright)]">
                    {r.currentRank ?? (
                      <span className="text-[var(--color-text-secondary)]">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {r.nextRank !== null ? (
                      <span className="text-[var(--color-text-secondary)]">
                        <span aria-hidden="true">↑ </span>
                        {r.nextRank}
                      </span>
                    ) : r.currentRank !== null ? (
                      /* Top of the ladder. An achievement, not missing data. */
                      <span className="text-[var(--color-brand-orange)]">Top of ladder</span>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4"><Num n={r.messageCount} /></td>
                  <td className="py-3 pr-4"><Num n={r.forumPostCount} /></td>
                  <td className="py-3 pr-4"><Num n={r.voiceJoinCount} /></td>
                  <td className="py-3 pr-4 font-mono text-xs text-[var(--color-text-secondary)]">
                    {GAME_LABEL[r.gameActivity] ?? r.gameActivity}
                  </td>
                  <td className="py-3 font-mono text-xs">
                    {r.qualifies ? (
                      <span className="text-[var(--color-brand-cyan-bright)]">YES</span>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">no</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {activity.rows.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
            No activity recorded for this month yet.
          </p>
        )}
      </Section>

    </>
  );
}
