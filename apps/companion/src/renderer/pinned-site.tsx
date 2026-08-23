import type { JSX } from 'preact';
import { siteDetail } from '@grims/shared/colony-site-detail';
import { buildTypeLabel } from '@grims/shared/colony-build-label';
import { EFFECT_KEYS, EFFECT_LABELS } from '@grims/shared/colony-system-summary';
import type { BuildTypeRow, ColonyPlan, PlanSite } from '../hub-colony.js';
import { Button, C, Card } from './ui.js';

/**
 * One site, pinned — the app's half of the pair.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Pin a site to see details about it. This will update in real time as you make changes." — and
 * "we need all of this in full parity on the website and the companion app".
 *
 * Every rule and sentence comes from @grims/shared, so this and the website cannot disagree about
 * whether a build is affordable or what it feeds. Only the chrome differs.
 */

const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' } as const;
const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

export function PinnedSite({
  site,
  plan,
  buildTypes,
  onClose,
}: {
  site: PlanSite;
  plan: ColonyPlan;
  buildTypes: readonly BuildTypeRow[];
  onClose: () => void;
}): JSX.Element {
  const type = site.buildTypeId === null ? undefined : buildTypes.find((b) => b.id === site.buildTypeId);

  /*
   * What is banked by the time THIS site is reached, not at the end. A site early in the order
   * cannot spend points a later build will produce, and the final total would call it affordable
   * when the game will refuse it.
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

  // Bound once rather than asserted seven times — a non-null assertion in a map is forbidden by lint.
  const fx = detail.effects;
  const moved: Array<[(typeof EFFECT_KEYS)[number], number]> =
    fx === null ? [] : EFFECT_KEYS.filter((k) => fx[k] !== 0).map((k) => [k, fx[k]]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '14px', color: C.text }}>
            {buildTypeLabel(site.buildTypeName, site.buildTypeId) || 'Nothing chosen here yet'}
          </div>
          <div style={{ ...MONO, fontSize: '11px', color: C.faint }}>
            #{site.position + 1} · {site.location} · {where}
            {site.totalTonnes === null ? '' : ` · ${site.totalTonnes.toLocaleString()} t`}
          </div>
        </div>
        <Button onClick={onClose}>Unpin</Button>
      </div>

      {detail.cost === null ? null : (
        <p style={{ ...MONO, margin: '7px 0 0', fontSize: '12px', color: detail.affordable ? C.dim : C.warn }}>
          Spends {detail.cost.points} T{detail.cost.tier} · {detail.cost.banked} banked by here
        </p>
      )}

      {moved.length === 0 ? null : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: '7px' }}>
          {/* Only the measures this build actually moves — seven rows of "+0" would bury the two that matter. */}
          {moved.map(([k, v]) => (
            <span key={k} style={{ ...MONO, fontSize: '11px', color: C.dim }}>
              {EFFECT_LABELS[k]} <span style={{ color: v < 0 ? C.warn : C.text }}>{signed(v)}</span>
            </span>
          ))}
        </div>
      )}

      {detail.notes.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '7px' }}>
          {detail.notes.map((n, i) => (
            <span
              key={n}
              style={{ fontSize: '12px', color: i === 0 && !detail.affordable ? C.warn : C.dim }}
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
