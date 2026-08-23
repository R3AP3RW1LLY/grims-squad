import type { JSX } from 'preact';
import {
  EFFECT_KEYS,
  EFFECT_LABELS,
  effectBar,
  summariseSystem,
  unknownSlotsNote,
} from '@grims/shared/colony-system-summary';
import { siteProgress } from '@grims/shared/colony-plan-progress';
import type { BuildTypeRow, ColonyPlan } from '../hub-colony.js';
import { C, Card } from './ui.js';

/** Local, matching planning.tsx — ui.ts does not export it and duplicating one line beats widening its surface. */
const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' } as const;

/**
 * What the whole system adds up to — the app's half of the pair.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "remember we need all of this in full parity on the website and the companion app"
 *
 * Every figure, label and rule comes from @grims/shared, so this and the website cannot disagree
 * about what a system is worth. What differs is only the chrome: Tailwind tokens there, the app's
 * palette here.
 *
 * The seven effects have come down per build type since the catalogue shipped and nothing ever added
 * them up. A member could see what one refinery does and never what their system does.
 */

const num = (n: number): string => n.toLocaleString('en-GB');
const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

export function SystemSummary({
  plan,
  buildTypes,
}: {
  plan: ColonyPlan;
  buildTypes: readonly BuildTypeRow[];
}): JSX.Element {
  const byId = new Map(buildTypes.map((b) => [b.id, b]));

  const summary = summariseSystem(
    plan.sites.map((s) => {
      const type = s.buildTypeId === null ? undefined : byId.get(s.buildTypeId);

      /*
       * Built comes from the PROJECT, via the same helper the website and the build order use. A
       * second rule here would eventually disagree with the first about the same site.
       */
      const progress = siteProgress({
        id: s.id,
        totalTonnes: s.totalTonnes,
        project:
          s.project === null || s.project === undefined
            ? null
            : {
                required: s.project.required,
                remaining: s.project.remaining,
                completedAt:
                  s.project.completedAt === null ? null : new Date(s.project.completedAt),
              },
      });

      return { effects: type?.effects ?? null, totalTonnes: s.totalTonnes, built: progress.state === 'complete' };
    }),
    // Unknown only when NEITHER number is recorded — one entered means somebody has already looked.
    plan.bodies
      .filter((b) => b.orbitalSlots === null && b.surfaceSlots === null)
      .map((b) => ({ bodyId: b.bodyId, name: b.name })),
  );

  const last = plan.simulation.steps[plan.simulation.steps.length - 1];
  const banked = { tier2: last?.tier2 ?? 0, tier3: last?.tier3 ?? 0 };
  const note = unknownSlotsNote(summary.unknownSlots);

  const row = (label: string, value: JSX.Element | string): JSX.Element => (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
      <span style={{ ...MONO, fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.faint, minWidth: '86px' }}>
        {label}
      </span>
      <span style={{ fontSize: '13px', color: C.text }}>{value}</span>
    </div>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
        <span style={{ fontSize: '14px', color: C.text }}>This system</span>
        <span style={{ ...MONO, fontSize: '11px', color: C.faint }}>
          {summary.counted} build{summary.counted === 1 ? '' : 's'} counted
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '8px' }}>
        {/*
          The score is OURS. Raven publishes a number and not its formula; one that looked like
          theirs and disagreed would be worse than none, because a member would plan against it.
        */}
        {row(
          'Score',
          <>
            {signed(summary.score)}{' '}
            <span style={{ fontSize: '11px', color: C.faint }}>· ours: the seven below, added up</span>
          </>,
        )}
        {row(
          'Tier points',
          <>
            {banked.tier2} T2 · {banked.tier3} T3{' '}
            <span style={{ fontSize: '11px', color: C.faint }}>banked when finished</span>
          </>,
        )}
        {row(
          'To haul',
          <>
            {num(summary.outstandingTonnes)} t{' '}
            <span style={{ fontSize: '11px', color: C.faint }}>of {num(summary.totalTonnes)} t all told</span>
          </>,
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '10px' }}>
        {EFFECT_KEYS.map((key) => {
          const value = summary.effects[key];
          const width = effectBar(value, summary.effects);

          return (
            <div key={key} style={{ display: 'grid', gridTemplateColumns: '116px 46px 1fr', gap: '8px', alignItems: 'center' }}>
              <span style={{ ...MONO, fontSize: '10px', color: C.faint }}>{EFFECT_LABELS[key]}</span>
              <span style={{ ...MONO, fontSize: '11px', textAlign: 'right', color: value < 0 ? C.warn : C.text }}>
                {signed(value)}
              </span>
              {/* Scaled to the largest value present — there is no published ceiling for any of these. */}
              <span style={{ display: 'block', height: '5px', borderRadius: '2px', background: C.sunken }}>
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    borderRadius: '2px',
                    width: `${Math.round(width * 100)}%`,
                    background: value < 0 ? C.warn : C.orange,
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>

      {note === null ? null : (
        <div style={{ marginTop: '10px', border: `1px solid ${C.hairline}`, borderRadius: '4px', padding: '7px 9px' }}>
          <p style={{ margin: 0, fontSize: '12px', color: C.dim }}>{note}</p>
          {/* Named, not just counted: a list somebody can work through with the architect view open. */}
          <p style={{ margin: '5px 0 0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {summary.unknownSlots.map((b) => (
              <span
                key={b.bodyId}
                style={{ ...MONO, fontSize: '10px', color: C.faint, border: `1px solid ${C.hairline}`, borderRadius: '3px', padding: '1px 5px' }}
              >
                {b.name}
              </span>
            ))}
          </p>
        </div>
      )}
    </Card>
  );
}
