'use client';

import { useState } from 'react';
import { formatUtcSeconds } from '../../../lib/time';

export interface AuditRow {
  id: string;
  action: string;
  actorHandle: string | null;
  /** Their Discord server nickname, which the hub keeps matching their CMDR name. */
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

/** Fixed at 100. A page size control is a setting nobody wants to think about. */
export const PAGE_SIZE = 100;

/**
 * The audit log viewer, filtered.
 *
 * Client-side so a filter change does not reload the page, but every filter is
 * applied by the SERVER. Filtering 100 fetched rows in the browser would be
 * quicker to write and would quietly answer a different question — "which of
 * the most recent hundred entries match" rather than "which entries match".
 */
export function AuditFilters({
  initial,
  actions,
  initialTotal,
}: {
  initial: AuditRow[];
  actions: string[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * Loads one page.
   *
   * The page number is passed in rather than read from state, because a click
   * on "next" has to fetch page N+1 and React has not re-rendered with the new
   * value yet. Reading state here would fetch the page they were already on.
   */
  async function load(targetPage: number) {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(targetPage) });
      if (actor.trim() !== '') q.set('actor', actor.trim());
      if (action !== '') q.set('action', action);
      if (since !== '') q.set('since', since);
      if (until !== '') q.set('until', until);

      const res = await fetch(`/v1/admin/audit?${q.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Could not load the audit log.');

      const j = (await res.json()) as { entries: AuditRow[]; total: number };
      setRows(j.entries);
      setTotal(j.total);
      setPage(targetPage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /*
   * Changing a filter returns to page ONE. Staying on page 7 of a result set
   * that now has two pages shows an empty table and looks like the filter
   * matched nothing.
   */
  const apply = () => void load(1);

  function reset() {
    setActor('');
    setAction('');
    setSince('');
    setUntil('');
    setRows(initial);
    setTotal(initialTotal);
    setPage(1);
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="f-actor" className="block text-xs text-[var(--color-text-secondary)]">
            Actor (handle)
          </label>
          <input
            id="f-actor"
            value={actor}
            onChange={(e) => setActor(e.currentTarget.value)}
            className="mt-1 w-40 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          />
        </div>

        <div>
          <label htmlFor="f-action" className="block text-xs text-[var(--color-text-secondary)]">
            Action
          </label>
          {/*
            A list of what is actually IN the log, not a free-text box. Nobody
            should have to guess whether it is "role.grant" or "roles.granted".
          */}
          <select
            id="f-action"
            value={action}
            onChange={(e) => setAction(e.currentTarget.value)}
            className="mt-1 w-52 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">Any action</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="f-since" className="block text-xs text-[var(--color-text-secondary)]">
            From
          </label>
          <input
            id="f-since"
            type="date"
            value={since}
            onChange={(e) => setSince(e.currentTarget.value)}
            className="mt-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          />
        </div>

        <div>
          <label htmlFor="f-until" className="block text-xs text-[var(--color-text-secondary)]">
            To
          </label>
          <input
            id="f-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.currentTarget.value)}
            className="mt-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          />
        </div>

        <button
          type="button"
          onClick={() => void apply()}
          disabled={busy}
          className="rounded border border-[var(--color-brand-cyan-bright)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-cyan-bright)] disabled:opacity-50"
        >
          Filter
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-[var(--color-border-hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]"
        >
          Reset
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="mt-4 text-sm text-[var(--color-brand-orange)]">
          {error}
        </p>
      )}

      <p aria-live="polite" className="mt-4 text-xs text-[var(--color-text-secondary)]">
        {total.toLocaleString('en-GB')} {total === 1 ? 'entry' : 'entries'}
        {pages > 1 && ` — page ${page} of ${pages}`}
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border-hairline)] text-left font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
              <th scope="col" className="py-2 pr-4">When (UTC)</th>
              <th scope="col" className="py-2 pr-4">Who</th>
              <th scope="col" className="py-2 pr-4">Action</th>
              <th scope="col" className="py-2">Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-[var(--color-border-hairline)]">
                <td className="py-2.5 pr-4 align-top whitespace-nowrap">
                  {/*
                    ★ ALWAYS UTC, ALWAYS LABELLED, ALWAYS TO THE SECOND ★

                    This is the one surface where several officers compare notes
                    about the same event, often from different countries. Local
                    time would make "which happened first" unanswerable from a
                    screenshot.

                    Seconds because privileged actions arrive in bursts — a role
                    change and the grant it caused land in the same minute, and
                    minute resolution loses the order between them.
                  */}
                  <time
                    dateTime={e.createdAt}
                    className="font-mono text-[var(--color-text-secondary)]"
                  >
                    {formatUtcSeconds(e.createdAt)}
                  </time>
                </td>
                <td className="py-2.5 pr-4 align-top">
                  {/*
                    ★ NAME FIRST, HANDLE UNDERNEATH ★

                    The name is what an officer recognises — it is the Discord
                    server nickname, which the hub keeps matching the member's
                    in-game commander name.

                    The handle stays visible rather than being replaced. A
                    display name is chosen by the member and can be changed to
                    match somebody else's, so a log that identified people by
                    name alone could be made to misattribute an action. The
                    handle is unique and stable, and it is what actually
                    identifies the row.
                  */}
                  {e.actorName !== null ? (
                    <>
                      <span className="text-[var(--color-text-primary)]">{e.actorName}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-text-secondary)]">
                        {e.actorHandle}
                      </span>
                    </>
                  ) : (
                    /*
                      "system" when there is no actor, and that is a real
                      distinction: a reconciliation or a promotion had no human
                      behind it, and showing a name there would be a lie about
                      who acted.
                    */
                    <span className="font-mono text-[var(--color-text-secondary)]">
                      {e.actorHandle ?? 'system'}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4 align-top font-mono text-[var(--color-brand-cyan-bright)]">
                  {e.action}
                </td>
                <td className="py-2.5 align-top font-mono text-[var(--color-text-secondary)]">
                  {e.targetId === null
                    ? '—'
                    : `${e.targetType ?? ''} ${e.targetId.slice(0, 8)}`.trim()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          Nothing matches those filters.
        </p>
      )}

      {pages > 1 && (
        <nav
          aria-label="Audit log pages"
          className="mt-6 flex items-center justify-between gap-4"
        >
          <button
            type="button"
            onClick={() => void load(page - 1)}
            disabled={busy || page <= 1}
            className="rounded border border-[var(--color-border-hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] disabled:opacity-40"
          >
            Newer
          </button>

          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {(page - 1) * PAGE_SIZE + 1}&ndash;{Math.min(page * PAGE_SIZE, total)} of{' '}
            {total.toLocaleString('en-GB')}
          </span>

          <button
            type="button"
            onClick={() => void load(page + 1)}
            disabled={busy || page >= pages}
            className="rounded border border-[var(--color-border-hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)] disabled:opacity-40"
          >
            Older
          </button>
        </nav>
      )}
    </div>
  );
}
