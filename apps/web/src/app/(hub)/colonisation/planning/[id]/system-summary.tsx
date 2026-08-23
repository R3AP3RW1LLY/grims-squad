import {
  EFFECT_KEYS,
  EFFECT_LABELS,
  effectBar,
  summariseSystem,
  unknownSlotsNote,
} from '@grims/shared/colony-system-summary';
import { siteProgress } from '@grims/shared/colony-plan-progress';
import type { ColonyBuildType, ColonyPlan } from '../../../../../lib/api';

/**
 * What the whole system adds up to.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "we would like our planning and scouting and all colonization pages to look like this ... but keep
 * our brand, theme and styling"
 *
 * The seven effects have come down per build type since the catalogue shipped and nothing ever added
 * them up. A member could see what one refinery does and never what their system does.
 *
 * ★ SAME INFORMATION AND DENSITY, ENTIRELY OUR OWN CHROME ★
 *
 * The reference panel is a blue box with green chevrons. This carries the same figures in the same
 * order at the same density, drawn in the platform's own tokens — a member should recognise this as
 * Grim's Squad, not as somebody else's tool with a different logo.
 */

const CARD =
  'rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-4 py-3';

/** Six digits unspaced are misread, and these are the numbers people plan hauling runs around. */
const num = (n: number): string => n.toLocaleString('en-GB');

/** A signed figure reads as a change; an unsigned one reads as a total. These are changes. */
const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

export function SystemSummary({
  plan,
  buildTypes,
}: {
  plan: ColonyPlan;
  buildTypes: readonly ColonyBuildType[];
}) {
  const byId = new Map(buildTypes.map((b) => [b.id, b]));

  const summary = summariseSystem(
    plan.sites.map((s) => {
      const type = s.buildTypeId === null ? undefined : byId.get(s.buildTypeId);

      /*
       * ★ "BUILT" COMES FROM THE PROJECT, NOT FROM A FLAG ★
       *
       * There is no `built` column and there should not be: a site is built when the PROJECT it
       * became reports itself complete. `siteProgress` is the one place that decides, and the build
       * order already reads it — a second rule here would eventually disagree with the first, and
       * the two would be describing the same site.
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

      return {
        effects: type?.effects ?? null,
        totalTonnes: s.totalTonnes,
        built: progress.state === 'complete',
      };
    }),
    /*
     * A body counts as unknown only when NEITHER number is recorded. One of the two entered is
     * somebody having looked — chipping it would send them back to a body they have already done.
     */
    plan.bodies
      .filter((b) => b.orbitalSlots === null && b.surfaceSlots === null)
      .map((b) => ({ bodyId: b.bodyId, name: b.name })),
  );

  const last = plan.simulation.steps[plan.simulation.steps.length - 1];
  const banked = { tier2: last?.tier2 ?? 0, tier3: last?.tier3 ?? 0 };
  const note = unknownSlotsNote(summary.unknownSlots);

  return (
    <div className={`${CARD} mt-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-sm font-medium text-[var(--color-text-primary)]">This system</h3>
        <span className="font-mono text-[11px] text-[var(--color-text-dim)]">
          {summary.counted} build{summary.counted === 1 ? '' : 's'} counted
        </span>
      </div>

      <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
        {/*
          ★ THE SCORE IS OURS, AND THE LABEL SAYS SO ★

          Raven publishes a "System Score" and not its formula. A number that looked like theirs and
          disagreed would be worse than showing none, because a member would plan against it. This
          is the seven effects added together — explainable in one sentence, and ours.
        */}
        <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
          Score
        </dt>
        <dd className="m-0 text-sm text-[var(--color-text-primary)]">
          {signed(summary.score)}{' '}
          <span className="text-[11px] text-[var(--color-text-dim)]">
            · our own figure: the seven below, added up
          </span>
        </dd>

        <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
          Tier points
        </dt>
        <dd className="m-0 text-sm text-[var(--color-text-primary)]">
          {banked.tier2} T2 · {banked.tier3} T3{' '}
          <span className="text-[11px] text-[var(--color-text-dim)]">banked when finished</span>
        </dd>

        <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
          To haul
        </dt>
        <dd className="m-0 text-sm text-[var(--color-text-primary)]">
          {num(summary.outstandingTonnes)} t{' '}
          <span className="text-[11px] text-[var(--color-text-dim)]">
            of {num(summary.totalTonnes)} t all told
          </span>
        </dd>
      </dl>

      <div className="mt-3 flex flex-col gap-1">
        {EFFECT_KEYS.map((key) => {
          const value = summary.effects[key];
          const width = effectBar(value, summary.effects);

          return (
            <div key={key} className="grid grid-cols-[9rem_3.5rem_1fr] items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--color-text-dim)]">
                {EFFECT_LABELS[key]}
              </span>
              <span
                className={`text-right font-mono text-xs tabular-nums ${
                  value < 0
                    ? 'text-[var(--color-semantic-warning)]'
                    : 'text-[var(--color-text-primary)]'
                }`}
              >
                {signed(value)}
              </span>
              {/*
                Scaled to the largest value present, never to an invented maximum — there is no
                published ceiling for any of these, and a bar against a made-up one would be a claim
                about the game rather than about this system.
              */}
              <span
                className="h-1.5 rounded-sm bg-[var(--color-surface-panel-sunken)]"
                aria-hidden="true"
              >
                <span
                  className={`block h-full rounded-sm ${
                    value < 0
                      ? 'bg-[var(--color-semantic-warning)]'
                      : 'bg-[var(--color-brand-orange)]'
                  }`}
                  style={{ width: `${Math.round(width * 100)}%` }}
                />
              </span>
            </div>
          );
        })}
      </div>

      {note === null ? null : (
        <div className="mt-3 rounded border border-[var(--color-border-subtle)] px-3 py-2">
          <p className="m-0 text-xs text-[var(--color-text-secondary)]">{note}</p>
          {/*
            Named, not just counted. "32 bodies" is a number to feel bad about; the names are a list
            somebody can actually work through with the architect view open.
          */}
          <p className="m-0 mt-1 flex flex-wrap gap-1">
            {summary.unknownSlots.map((b) => (
              <span
                key={b.bodyId}
                className="rounded border border-[var(--color-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-dim)]"
              >
                {b.name}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
