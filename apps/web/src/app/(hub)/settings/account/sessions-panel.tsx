'use client';

import { useState } from 'react';

export interface SessionRow {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function readCsrf(): string {
  const jar = document.cookie.split('; ');
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const hit = jar.find((c) => c.startsWith(`${name}=`));
    if (hit !== undefined) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return '';
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

/**
 * Signed-in devices, and the means to end any of them.
 *
 * A revoked row is removed from the list immediately rather than marked. The
 * member's question is "is that device still signed in", and leaving a greyed
 * row that says "revoked" answers a different one.
 */
export function SessionsPanel({ initial }: { initial: SessionRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/v1/me/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrf() },
      });
      if (!res.ok) throw new Error(String(res.status));
      setRows((r) => r.filter((s) => s.id !== id));
    } catch {
      setError('That session was not ended. It is still signed in — please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <p className="mt-8 text-sm text-[var(--color-text-secondary)]">No active sessions.</p>;
  }

  return (
    <div className="mt-8">
      {error !== null && (
        <p
          role="alert"
          className="mb-6 rounded border border-[var(--color-brand-orange)] px-4 py-3 text-sm text-[var(--color-brand-orange)]"
        >
          {error}
        </p>
      )}
      <ul className="space-y-1">
        {rows.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--color-border-hairline)] py-4"
          >
            <div className="min-w-0">
              <p className="text-[var(--color-text-primary)]">
                {s.deviceLabel ?? s.userAgent ?? 'Unknown device'}
                {s.current && (
                  <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-brand-cyan-bright)]">
                    This device
                  </span>
                )}
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">
                Last used {when(s.lastUsedAt)} UTC · signed in {when(s.createdAt)} UTC
              </p>
            </div>
            <button
              type="button"
              onClick={() => void revoke(s.id)}
              disabled={busy === s.id}
              className="rounded border border-[var(--color-border-hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-text-primary)] hover:border-[var(--color-brand-orange)] hover:text-[var(--color-brand-orange)] disabled:opacity-50"
            >
              {s.current ? 'Sign out' : 'End session'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
