'use client';

import { useState } from 'react';
import { apiCall } from '../../../lib/api-client';
import type { PromotionReport } from '../../../lib/api';

/**
 * Running the promotions for one month, on demand.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "this needs to run on the first of every month, however, we are still onboarding, and we need an
 * override! add a button to each month, that will trigger promotions beyond the job that runs once
 * a month on the 1st day of the month."
 *
 * ★ PREVIEW FIRST, ALWAYS ★
 *
 * The owner asked for a preview on a whole-month run: it moves many people at once, and seeing the
 * list is the difference between a decision and a hope. The preview is the engine's own dry run
 * rather than a separate description of what it would do — one implementation, so the list cannot
 * disagree with what happens next.
 *
 * ★ AND IT NAMES THE MONTH, LOUDLY ★
 *
 * A run scoped to the CURRENT month credits a month that has not finished, which is the thing the
 * promotion floor exists to prevent on partial data. The owner chose per-month scoping knowing
 * that. What this component owes them is never letting it happen by accident: the month is in the
 * button, in the confirmation, and carries a warning when it is the one still running.
 */

const monthName = (month: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (m === null) return month;

  // UTC, matching how the months are keyed. A local Date would name the previous month for anybody
  // west of Greenwich.
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/** The month we are in now, in the same `YYYY-MM` shape the tabs use. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function PromotionRun({ month }: { readonly month: string }) {
  const [report, setReport] = useState<PromotionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PromotionReport | null>(null);

  const incomplete = month === currentMonth();

  const call = async (path: string): Promise<PromotionReport> =>
    apiCall<PromotionReport>('POST', `${path}?month=${encodeURIComponent(month)}`);

  const preview = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setReport(await call('/v1/admin/promotions/preview'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The preview could not be run.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await call('/v1/admin/promotions/run');
      setDone(result);
      setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The run could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-orange)]">
            Promotions
          </h3>
          <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            Runs the ladder as it stood at the end of {monthName(month)}. The job on the 1st does the
            same thing on its own — this is for running it sooner.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void preview()}
          className="shrink-0 rounded border border-[var(--color-brand-cyan-bright)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_12%,transparent)] disabled:opacity-40"
        >
          {busy && report === null ? 'Checking…' : `Run ${monthName(month)}`}
        </button>
      </div>

      {incomplete && (
        /*
          The one thing that can go wrong quietly. A member active on the 1st and absent since would
          be promoted on two days of data, and nothing afterwards would say so.
        */
        <p className="mt-3 rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_8%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-brand-orange)]">
          {monthName(month)} has not finished. Running it now counts a partial month, so somebody
          active on the 1st and absent since would still be promoted.
        </p>
      )}

      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded border border-[var(--color-semantic-hostile)] px-3 py-2 text-[11px] text-[var(--color-semantic-hostile-bright)]"
        >
          {error}
        </p>
      )}

      {done !== null && (
        <div className="mt-3 rounded border border-[var(--color-brand-cyan)] px-3 py-2 text-[11px] text-[var(--color-brand-cyan-bright)]">
          {done.promoted === 0
            ? `Ran ${monthName(month)}. Nobody was due — ${done.considered} members considered.`
            : `Promoted ${done.promoted} of ${done.considered} considered.`}
          {done.failed.length > 0 && (
            <span className="mt-1 block text-[var(--color-semantic-hostile-bright)]">
              {/*
                Discord refused these, and NEITHER side was changed. Worth saying: the usual cause is
                the bot's role sitting below theirs, which an officer can fix in Server Settings.
              */}
              {done.failed.length} could not be applied in Discord: {done.failed.map((f) => f.handle).join(', ')}
            </span>
          )}
        </div>
      )}

      {report !== null && (
        <div className="mt-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-void)] p-3">
          {report.wouldPromote.length === 0 ? (
            <p className="m-0 text-[11px] text-[var(--color-text-secondary)]">
              Nobody is due for {monthName(month)}. {report.considered} members were considered
              {report.skipped.length > 0 && ` — ${report.skipped.length} are still short of a rung`}.
            </p>
          ) : (
            <>
              <p className="m-0 text-[11px] text-[var(--color-text-primary)]">
                {report.wouldPromote.length} would be promoted, of {report.considered} considered.
                Nothing has been written yet.
              </p>
              <ul className="m-0 mt-2 max-h-56 list-none space-y-1 overflow-y-auto p-0">
                {report.wouldPromote.map((p) => (
                  <li key={p.userId} className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                    <span className="text-[var(--color-text-primary)]">{p.handle}</span> {p.from}{' '}
                    &rarr;{' '}
                    <span className="text-[var(--color-brand-cyan-bright)]">{p.to}</span>
                    <span className="ml-2 text-[var(--color-text-dim)]">
                      {p.qualifyingMonths} qualifying month{p.qualifyingMonths === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {report.wouldPromote.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply()}
                className="rounded border border-[var(--color-brand-orange)] bg-[color-mix(in_srgb,var(--color-brand-orange)_14%,transparent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-orange-bright)] disabled:opacity-40"
              >
                {busy ? 'Promoting…' : `Promote these ${report.wouldPromote.length}`}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setReport(null)}
              className="rounded border border-[var(--color-border-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
