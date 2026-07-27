import type { Metadata } from 'next';
import { getAdminActivity, getAdminAudit } from '../../lib/api';
import { StepUp } from './step-up';
import { AuditFilters } from './audit-filters';

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

function Num({ n, dim = false }: { n: number; dim?: boolean }) {
  return (
    <span
      className={`font-mono ${n === 0 || dim ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}
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

export default async function AdminPage() {
  const [activity, audit] = await Promise.all([getAdminActivity(), getAdminAudit()]);

  if (activity === null) return <StepUp />;

  const qualifying = activity.rows.filter((r) => r.qualifies).length;

  return (
    <main id="main" className="mx-auto max-w-[1440px] px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-brand-cyan-bright)]">
        Squadron leadership
      </p>
      <h1
        className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] leading-tight text-[var(--color-brand-orange)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        ADMIN CONSOLE
      </h1>
      <div className="rule-glow mt-5" aria-hidden="true" />

      <nav aria-label="Admin sections" className="mt-8">
        <a
          href="/app/roles"
          className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)]"
        >
          Roles &amp; permissions
        </a>
      </nav>

      <section aria-labelledby="activity-heading" className="mt-12">
        <h2
          id="activity-heading"
          className="text-xl text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ACTIVITY — {activity.month}
        </h2>
        <p className="mt-3 max-w-[70ch] text-sm text-[var(--color-text-muted)]">
          {qualifying} of {activity.rows.length} tracked members qualify this month. A month counts
          when there is any Discord activity <em>and</em> an Elite session. Nothing is promoted
          before 1 August 2026, and the first live run will follow a dry run you have read.
        </p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-hairline)] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
                <th scope="col" className="py-3 pr-4">Member</th>
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
                      <span className="text-[var(--color-text-muted)]">
                        Discord only ({r.discordId})
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4"><Num n={r.messageCount} /></td>
                  <td className="py-3 pr-4"><Num n={r.forumPostCount} /></td>
                  <td className="py-3 pr-4"><Num n={r.voiceJoinCount} /></td>
                  <td className="py-3 pr-4 font-mono text-xs text-[var(--color-text-muted)]">
                    {GAME_LABEL[r.gameActivity] ?? r.gameActivity}
                  </td>
                  <td className="py-3 font-mono text-xs">
                    {r.qualifies ? (
                      <span className="text-[var(--color-brand-cyan-bright)]">YES</span>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">no</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {activity.rows.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-text-muted)]">
            No activity recorded for this month yet.
          </p>
        )}
      </section>

      <section aria-labelledby="audit-heading" className="mt-16">
        <h2
          id="audit-heading"
          className="text-xl text-[var(--color-brand-orange)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          AUDIT LOG
        </h2>
        <p className="mt-3 max-w-[70ch] text-sm text-[var(--color-text-muted)]">
          Read-only here and append-only in the database. A console that can edit the audit log is
          an audit log that proves nothing.
        </p>

        <AuditFilters initial={audit?.entries ?? []} actions={audit?.actions ?? []} />
      </section>
    </main>
  );
}
