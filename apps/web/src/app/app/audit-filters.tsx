'use client';

import { useState } from 'react';

export interface AuditRow {
  id: string;
  action: string;
  actorHandle: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

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
}: {
  initial: AuditRow[];
  actions: string[];
}) {
  const [rows, setRows] = useState(initial);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ limit: '200' });
      if (actor.trim() !== '') q.set('actor', actor.trim());
      if (action !== '') q.set('action', action);
      if (since !== '') q.set('since', since);
      if (until !== '') q.set('until', until);

      const res = await fetch(`/v1/admin/audit?${q.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Could not load the audit log.');
      const j = (await res.json()) as { entries: AuditRow[] };
      setRows(j.entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setActor('');
    setAction('');
    setSince('');
    setUntil('');
    setRows(initial);
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="f-actor" className="block text-xs text-[var(--color-text-muted)]">
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
          <label htmlFor="f-action" className="block text-xs text-[var(--color-text-muted)]">
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
          <label htmlFor="f-since" className="block text-xs text-[var(--color-text-muted)]">
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
          <label htmlFor="f-until" className="block text-xs text-[var(--color-text-muted)]">
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
          className="rounded border border-[var(--color-border-hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
        >
          Reset
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="mt-4 text-sm text-[var(--color-brand-orange)]">
          {error}
        </p>
      )}

      <p aria-live="polite" className="mt-4 text-xs text-[var(--color-text-muted)]">
        {rows.length} entries
      </p>

      <ul className="mt-2 space-y-1">
        {rows.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap gap-x-4 border-b border-[var(--color-border-hairline)] py-2.5 font-mono text-xs"
          >
            <time dateTime={e.createdAt} className="w-40 shrink-0 text-[var(--color-text-muted)]">
              {new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
            </time>
            <span className="text-[var(--color-brand-cyan-bright)]">{e.action}</span>
            <span className="text-[var(--color-text-muted)]">
              {/*
                "system" when there is no actor, and that is a real distinction:
                a reconciliation or a promotion had no human behind it, and
                showing a name there would be a lie about who acted.
              */}
              {e.actorHandle ?? 'system'}
              {e.targetId !== null && ` → ${e.targetType ?? ''} ${e.targetId.slice(0, 8)}`}
            </span>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">
          Nothing matches those filters.
        </p>
      )}
    </div>
  );
}
