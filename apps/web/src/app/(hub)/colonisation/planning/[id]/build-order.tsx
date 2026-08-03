'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ColonyPlan } from '../../../../../lib/api';
import { apiPatch } from '../../../../../lib/api-client';

/**
 * The order things get built in, with the running total.
 *
 * ★ THE ORDER IS PART OF THE PLAN, NOT A PRESENTATION CHOICE ★
 *
 * The game earns and spends construction points in sequence, so the same set of builds in a
 * different order is a different plan — one that works and one that stalls halfway. That is why
 * position is stored rather than derived, and why this list is editable at all.
 *
 * ★ BUTTONS, NOT DRAG AND DROP ★
 *
 * We have no drag library, and adding one to reorder a list would be a dependency for a control
 * that does not work with a keyboard and behaves badly on a phone. Up and down are operable by
 * anybody, and send the same whole-order save a drag would.
 */

const CHIP =
  'rounded border border-[var(--color-border-hairline)] px-2 py-0.5 font-mono text-[10px] ' +
  'text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-active)] ' +
  'hover:text-[var(--color-text-primary)] disabled:opacity-30';

export function BuildOrder({ plan, canEdit }: { plan: ColonyPlan; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plan.sites.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing planned yet. Add builds to bodies above and they appear here in the order they would
        be constructed.
      </p>
    );
  }

  const move = async (from: number, to: number): Promise<void> => {
    const ids = plan.sites.map((s) => s.id);
    const moved = ids[from];
    if (moved === undefined || to < 0 || to >= ids.length) return;

    ids.splice(from, 1);
    ids.splice(to, 0, moved);

    setBusy(true);
    try {
      await apiPatch(`/v1/logistics/colony/plans/${encodeURIComponent(plan.id)}/order`, {
        version: plan.version,
        siteIds: ids,
      });
      setError(null);
      router.refresh();
    } catch (err) {
      // The stale-save message names both revisions. It is the only thing that explains what
      // happened when two officers are editing the same plan, so it is shown rather than replaced.
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Accumulated down the list, so each row says what the plan costs UP TO AND INCLUDING it. That is
   * the number somebody uses to draw a line — "we can fund the first four" — which a per-row figure
   * alone cannot answer without adding them up by eye.
   */
  let running = 0;

  return (
    <div>
      {error === null ? null : (
        <p className="m-0 mb-4 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      <ol className="m-0 list-none p-0">
        {plan.sites.map((s, i) => {
          running += s.totalTonnes ?? 0;
          const body = plan.bodies.find((b) => b.bodyId === s.bodyId);
          const shortName =
            body === undefined
              ? 'not placed'
              : body.name.startsWith(plan.systemName)
                ? body.name.slice(plan.systemName.length).trim() || body.name
                : body.name;

          return (
            <li
              key={s.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--color-border-hairline)] py-2"
            >
              <span className="text-sm">
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-dim)]">
                  {String(i + 1).padStart(2, '0')}
                </span>{' '}
                <span className="text-[var(--color-text-primary)]">
                  {s.buildTypeName ?? 'nothing chosen yet'}
                </span>
                <span className="ml-2 text-[11px] text-[var(--color-text-secondary)]">
                  {shortName} · {s.location}
                  {s.tier === null ? '' : ` · T${s.tier}`}
                </span>
                {s.isPrimary ? (
                  <span
                    className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-brand-orange)]"
                    title="The first station in a system. The game charges no construction points for it."
                  >
                    primary
                  </span>
                ) : null}
              </span>

              <span className="flex items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                  {s.totalTonnes === null ? '—' : `${s.totalTonnes.toLocaleString()} t`}
                  <span className="ml-2 text-[var(--color-text-dim)]">
                    Σ {running.toLocaleString()}
                  </span>
                </span>

                {canEdit ? (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      className={CHIP}
                      aria-label="Move earlier"
                      onClick={() => void move(i, i - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === plan.sites.length - 1}
                      className={CHIP}
                      aria-label="Move later"
                      onClick={() => void move(i, i + 1)}
                    >
                      ↓
                    </button>
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="m-0 mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
        {/*
          Said out loud, because moving the top row moves the primary with it — and that changes
          what the game charges, not just the reading order.
        */}
        {plan.sites.length} site{plan.sites.length === 1 ? '' : 's'} ·{' '}
        {running.toLocaleString()} t in total · the first is the primary port, and moving it changes
        which build that is
      </p>
    </div>
  );
}
