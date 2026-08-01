'use client';

import { useState } from 'react';
import { apiPost } from '../../../../lib/api-client';

/**
 * Pick a rank and see the site as it sees it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "on the roles page, we need to add a way for the webmaster and officers to visually spoof a rank
 * and physically see what they see in the web app so we can verify that everything is working on
 * that front"
 *
 * ★ IT IS ON THE ROLES PAGE BECAUSE THE MASK IS ★
 *
 * The permission editor answers "what does this role GRANT" — a list of bits. This answers "what
 * does that actually look like", which is the question a list of bits cannot. Side by side, an
 * officer can change a mask and immediately walk the result.
 *
 * ★ WHAT IT CANNOT DO ★
 *
 * Grant anything. The previewed mask is your own AND the role's, so there is no role you can pick
 * that gives you a permission you did not already hold — see `previewMask` in the contract. And
 * every write is refused while it runs, so this is a way to LOOK, never a way to act as somebody
 * else.
 */
export function ViewAsPicker({ roles }: { roles: Array<{ id: string; name: string }> }) {
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function begin() {
    if (roleId === '') {
      setProblem('Choose a rank first.');
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await apiPost('/v1/admin/view-as', { roleId });
      /*
       * Sent to the dashboard, not left here.
       *
       * The roles page needs ROLE_MANAGE, which most ranks do not have — so previewing as a Cadet
       * and staying put would land on the page's own "no access" screen. Correct, and a baffling
       * first impression of the feature. The dashboard is the page every rank can reach, which
       * makes it the right place to start looking around.
       *
       * A full navigation rather than a router push: the preview changes what the SERVER renders.
       */
      window.location.href = '/dashboard';
    } catch (e) {
      setBusy(false);
      setProblem(e instanceof Error ? e.message : 'Could not start the preview.');
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
            See the site as
          </span>
          <select
            className="w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            <option value="">Choose a rank…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void begin()}
          disabled={busy}
          className="rounded-md border border-[var(--color-brand-cyan)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-brand-cyan-bright)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_16%,transparent)] disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start preview'}
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
        The whole site renders as that rank sees it — sidebar, pages and all. It is read only:
        nothing can be changed while a preview is running, and it can never show you more than your
        own rank allows. A banner across the top carries the way out, and it lapses on its own after
        an hour.
      </p>

      {problem !== null && (
        <p className="mt-2 text-xs text-[var(--color-semantic-hostile-bright)]">{problem}</p>
      )}
    </div>
  );
}
