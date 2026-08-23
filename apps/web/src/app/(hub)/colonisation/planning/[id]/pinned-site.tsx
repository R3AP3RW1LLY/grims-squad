'use client';

import { siteDetail } from '@grims/shared/colony-site-detail';
import { buildTypeLabel } from '@grims/shared/colony-build-label';
import { EFFECT_KEYS, EFFECT_LABELS } from '@grims/shared/colony-system-summary';
import type { ColonyBuildType, ColonyPlan, PlanSite } from '../../../../../lib/api';

/**
 * One site, pinned, answering "can I build this and should I".
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Pin a site to see details about it. This will update in real time as you make changes."
 *
 * Every fact here was already on the plan and never assembled: the catalogue knows what a build
 * costs and does, the simulation knows what is banked by the time it is reached, the economy column
 * knows what it feeds. Choosing between two builds meant reading three places and holding the
 * difference in your head.
 *
 * ★ IT UPDATES BECAUSE IT IS DERIVED, NOT STORED ★
 *
 * Nothing here is cached. It is computed from the plan on every render, so reordering the build
 * order changes what is banked by the time this site is reached, and this panel changes with it —
 * which is the whole reason to pin one while editing.
 */

const CARD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3';

const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

export function PinnedSite({
  site,
  plan,
  buildTypes,
  onClose,
}: {
  site: PlanSite;
  plan: ColonyPlan;
  buildTypes: readonly ColonyBuildType[];
  onClose: () => void;
}) {
  const type = site.buildTypeId === null ? undefined : buildTypes.find((b) => b.id === site.buildTypeId);

  /*
   * What the order has banked by the time THIS site is reached — not at the end. A site early in
   * the order cannot spend points a later build will produce, and showing the final total would
   * call it affordable when the game will refuse it.
   */
  const step = plan.simulation.steps.find((x) => x.siteId === site.id);
  const banked = { tier2: step?.tier2 ?? 0, tier3: step?.tier3 ?? 0 };

  const detail = siteDetail({
    buildTypeId: site.buildTypeId,
    buildTypeName: site.buildTypeName,
    tier: site.tier,
    totalTonnes: site.totalTonnes,
    location: site.location,
    effects: type?.effects ?? null,
    needsTier: type?.needsTier ?? 0,
    needsPoints: type?.needsPoints ?? 0,
    bankedTier2: banked.tier2,
    bankedTier3: banked.tier3,
    economyInfluence: site.economyInfluence,
    isPrimary: site.isPrimary,
  });

  const body = plan.bodies.find((b) => b.bodyId === site.bodyId);
  const where = body === undefined ? 'not placed' : body.name;

  /*
   * Bound once rather than asserted seven times. A non-null assertion inside a map is forbidden by
   * lint and rightly so: it claims a guarantee the narrowing has already lost by then.
   */
  const fx = detail.effects;
  const moved: Array<[(typeof EFFECT_KEYS)[number], number]> =
    fx === null ? [] : EFFECT_KEYS.filter((k) => fx[k] !== 0).map((k) => [k, fx[k]]);

  return (
    <div className={`${CARD} mt-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="m-0 text-sm font-medium text-[var(--color-text-primary)]">
            {buildTypeLabel(site.buildTypeName, site.buildTypeId) || 'Nothing chosen here yet'}
          </h3>
          <p className="m-0 font-mono text-[11px] text-[var(--color-text-dim)]">
            #{site.position + 1} · {site.location} · {where}
            {site.totalTonnes === null ? '' : ` · ${site.totalTonnes.toLocaleString()} t`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[var(--color-border-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)]"
        >
          Unpin
        </button>
      </div>

      {detail.cost === null ? null : (
        <p
          className={`m-0 mt-2 font-mono text-xs ${
            detail.affordable
              ? 'text-[var(--color-text-secondary)]'
              : 'text-[var(--color-semantic-warning)]'
          }`}
        >
          Spends {detail.cost.points} T{detail.cost.tier} · {detail.cost.banked} banked by here
        </p>
      )}

      {moved.length === 0 ? null : (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {/*
            Only the measures this build actually moves. Seven rows of "+0" would bury the two that
            matter under five that do not — the panel exists to make a comparison quick.
          */}
          {moved.map(([k, v]) => (
            <span key={k} className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              {EFFECT_LABELS[k]}{' '}
              <span
                className={
                  v < 0
                    ? 'text-[var(--color-semantic-warning)]'
                    : 'text-[var(--color-text-primary)]'
                }
              >
                {signed(v)}
              </span>
            </span>
          ))}
        </div>
      )}

      {detail.notes.length === 0 ? null : (
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {detail.notes.map((n, i) => (
            <li
              key={n}
              className={`text-xs ${
                i === 0 && !detail.affordable
                  ? 'text-[var(--color-semantic-warning)]'
                  : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
