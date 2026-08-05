'use client';

import { useMemo, useState } from 'react';
import { PERMISSION_NAMES, Permission } from '@grims/shared/permissions';
import { apiPost } from '../../../../lib/api-client';
import type { AdminRoleRow } from '../../../../lib/api';

/**
 * Pick a rank and see the site as it sees it.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "on the roles page, we need to add a way for the webmaster and officers to visually spoof a rank
 * and physically see what they see in the web app so we can verify that everything is working on
 * that front"
 *
 * ★ AND, AN HOUR LATER ★
 *
 * "im viewing as the Galactic Admiral role, and its showing me the same view as a cadet would see,
 * and this is certainly not the case! this needs to be really clear and accurate please!"
 *
 * Two separate faults sat behind that, which is why it was so confusing:
 *
 *   THE BUG      Prisma returns `perm_mask` as a Decimal, and `Decimal.toString()` goes exponential
 *                at 1e21. Every mask here is about 1.198e21, so `BigInt()` threw on every role that
 *                grants anything — swallowed into a mask of zero. Fixed in the store, with a test.
 *
 *   THE TRUTH    Ten of the twenty roles grant NOTHING. The whole tenure ladder — Cadet through
 *                Grand Master General — has an empty mask, so previewing any of them correctly
 *                shows a nearly empty site. Indistinguishable from the bug, and not something a
 *                list of role names could ever have conveyed.
 *
 * So the picker now states what each role grants BEFORE it is chosen. An officer who selects a rank
 * that grants nothing is told so, on the spot, rather than finding out by staring at a bare page and
 * wondering which of the two they are looking at.
 */

/** How many permissions a decimal-string mask carries, and whether it is empty. */
function describeMask(permMask: string): { count: number; sample: string[] } {
  let mask: bigint;
  try {
    mask = BigInt(permMask);
  } catch {
    // A mask we cannot read is reported as unknown rather than as zero. Zero is a real answer here
    // and claiming it falsely is the exact mistake this whole file is about.
    return { count: -1, sample: [] };
  }

  const held = PERMISSION_NAMES.filter((name) => (mask & Permission[name]) !== 0n);
  return { count: held.length, sample: held.slice(0, 4) };
}

export function ViewAsPicker({ roles }: { roles: AdminRoleRow[] }) {
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Computed once for every role, so the dropdown can carry the count on each option and the
  // explanation below can describe the one that is selected.
  const described = useMemo(
    () => new Map(roles.map((r) => [r.id, describeMask(r.permMask)])),
    [roles],
  );

  const chosen = roles.find((r) => r.id === roleId) ?? null;
  const detail = chosen === null ? null : (described.get(chosen.id) ?? null);

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
       * and staying put would land on this page's own "no access" screen. Correct, and a baffling
       * first impression of the feature. The dashboard is the page every rank can reach.
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
        <label className="block min-w-[260px] flex-1">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
            See the site as
          </span>
          <select
            className="w-full rounded-md border border-[var(--color-border-hairline)] bg-[var(--color-surface-void)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            <option value="">Choose a rank…</option>
            {roles.map((r) => {
              const d = described.get(r.id);
              /*
                The count is IN the option text. Somebody scanning the list can see at a glance that
                the entire tenure ladder grants nothing — which is a fact about this squadron's
                configuration that nothing else on the page states.
              */
              const suffix =
                d === undefined || d.count < 0
                  ? ' — mask unreadable'
                  : d.count === 0
                    ? ' — grants nothing'
                    : ` — ${d.count} permission${d.count === 1 ? '' : 's'}`;
              return (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {suffix}
                </option>
              );
            })}
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

      {/*
        ★ WHAT YOU ARE ABOUT TO SEE, BEFORE YOU SEE IT ★

        The difference between "this role grants nothing, so the site will look bare" and "something
        is broken" is impossible to tell from the resulting page. Said here, it is impossible to
        confuse.
      */}
      {detail !== null && chosen !== null && (
        <p
          className={`mt-3 rounded-md border p-3 text-xs ${
            detail.count === 0
              ? 'border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] text-[var(--color-text-secondary)]'
              : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)]'
          }`}
        >
          {detail.count === 0 ? (
            <>
              <strong className="text-[var(--color-semantic-warning)]">
                {chosen.name} grants no permissions at all.
              </strong>{' '}
              The preview will show a nearly empty site, and that is accurate — everyone holding only
              this role sees exactly that. On this squadron the whole tenure ladder is like this;
              permissions come from the leadership appointments and from Webmaster.
            </>
          ) : (
            <>
              <strong className="text-[var(--color-text-primary)]">
                {chosen.name} grants {detail.count} permissions
              </strong>
              , including {detail.sample.join(', ')}
              {detail.count > detail.sample.length ? ' and others' : ''}. You will see the
              intersection with your own — a preview can never show you more than your rank already
              allows.
            </>
          )}
        </p>
      )}

      <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
        The whole site renders as that rank sees it — sidebar, pages and all. It is read only:
        nothing can be changed while a preview is running. A banner across the top carries the way
        out, and it lapses on its own after an hour.
      </p>

      {problem !== null && (
        <p className="mt-2 text-xs text-[var(--color-semantic-hostile-bright)]">{problem}</p>
      )}
    </div>
  );
}
