'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ColonyPlan, PlanProblem, PlanSimStep } from '../../../../../lib/api';
import { apiPatch } from '../../../../../lib/api-client';

/**
 * The order things get built in, what each step costs, and whether it can be paid for.
 *
 * ★ THE ORDER IS PART OF THE PLAN, NOT A PRESENTATION CHOICE ★
 *
 * The game earns and spends construction points in sequence, so the same set of builds in a
 * different order is a different plan — one that works and one that stalls halfway. That is why
 * position is stored rather than derived, and why this list is editable at all.
 *
 * ★ THE DEFICIT IS SHOWN AT THE STEP IT HAPPENS ★
 *
 * A total that balances hides a plan that cannot be built: step four runs out of tier-2 points and
 * step nine pays them back, so the sum looks fine and the squadron gets stuck at step four with a
 * fortnight of hauling behind them. So the balance is printed on every row, and the row that goes
 * negative says so in a sentence.
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

/** The running balance, in the two currencies the game keeps. */
function Balance({ step }: { step: PlanSimStep | undefined }) {
  if (step === undefined) return null;

  const cell = (label: string, value: number) => (
    <span
      className={
        value < 0
          ? 'text-[var(--color-semantic-hostile-bright)]'
          : 'text-[var(--color-text-secondary)]'
      }
    >
      {label} {value > 0 ? '+' : ''}
      {value}
    </span>
  );

  return (
    <span className="flex gap-2 font-mono text-[10px] tabular-nums">
      {cell('T2', step.tier2)}
      {cell('T3', step.tier3)}
    </span>
  );
}

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
  const sim = plan.simulation;

  return (
    <div>
      {error === null ? null : (
        <p className="m-0 mb-4 rounded border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_7%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-warning)]">
          {error}
        </p>
      )}

      <Verdict problems={sim.problems} />

      <ol className="m-0 list-none p-0">
        {plan.sites.map((s, i) => {
          running += s.totalTonnes ?? 0;
          const step = sim.steps[i];
          const body = plan.bodies.find((b) => b.bodyId === s.bodyId);
          const shortName =
            body === undefined
              ? 'not placed'
              : body.name.startsWith(plan.systemName)
                ? body.name.slice(plan.systemName.length).trim() || body.name
                : body.name;

          const broken = (step?.problems.length ?? 0) > 0;

          return (
            <li
              key={s.id}
              className={
                'border-t py-2 ' +
                (broken
                  ? 'border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_5%,transparent)] px-2'
                  : 'border-[var(--color-border-hairline)]')
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
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
                  <Cost step={step} />
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                    {s.totalTonnes === null ? '—' : `${s.totalTonnes.toLocaleString()} t`}
                    <span className="ml-2 text-[var(--color-text-dim)]">
                      Σ {running.toLocaleString()}
                    </span>
                  </span>
                  <Balance step={step} />

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
              </div>

              {step?.problems.map((p) => (
                <p
                  key={p.message}
                  className="m-0 mt-1 text-[11px] text-[var(--color-semantic-hostile-bright)]"
                >
                  {p.message}
                </p>
              ))}
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

      {/* What it becomes before how good it gets: the economy is the decision, the scalars grade it. */}
      <Economy plan={plan} />
      <Effects plan={plan} />
    </div>
  );
}

/** What one step costs and earns in construction points. */
function Cost({ step }: { step: PlanSimStep | undefined }) {
  if (step === undefined) return null;
  if (step.spend === null && step.earn === null) return null;

  return (
    <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-dim)]">
      {step.spend === null ? null : (
        <span
          className="text-[var(--color-semantic-warning)]"
          title={
            step.surcharge > 0
              ? `${step.surcharge} of this is the surcharge the game adds to every starport after the second.`
              : undefined
          }
        >
          −{step.spend.points} T{step.spend.tier}
          {step.surcharge > 0 ? '*' : ''}
        </span>
      )}
      {step.spend !== null && step.earn !== null ? ' ' : null}
      {step.earn === null ? null : (
        <span className="text-[var(--color-brand-cyan-bright)]">
          +{step.earn.points} T{step.earn.tier}
        </span>
      )}
    </span>
  );
}

/**
 * Everything wrong with the plan, at the top where it cannot be missed.
 *
 * Silence when there is nothing wrong. A permanent "0 problems" banner trains people to ignore the
 * space, which is the one place a real problem has to appear.
 */
function Verdict({ problems }: { problems: readonly PlanProblem[] }) {
  if (problems.length === 0) return null;

  return (
    <div className="mb-4 rounded border border-[var(--color-semantic-hostile)] bg-[color-mix(in_srgb,var(--color-semantic-hostile)_6%,transparent)] px-4 py-3">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-semantic-hostile-bright)]">
        This plan cannot be built in this order
      </p>
      <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-primary)]">
        {problems.map((p) => (
          <li key={p.message}>{p.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Catalogue economies are stored lowercase and single-word. Members read them as words. */
const ECONOMY_NAMES: Readonly<Record<string, string>> = {
  agriculture: 'Agriculture',
  colony: 'Colony',
  extraction: 'Extraction',
  hightech: 'High Tech',
  industrial: 'Industrial',
  military: 'Military',
  refinery: 'Refinery',
  service: 'Service',
  terraforming: 'Terraforming',
  tourism: 'Tourism',
};

const economyName = (key: string): string => ECONOMY_NAMES[key] ?? key;

/**
 * What the system BECOMES — the answer the build books lead with.
 *
 * ★ THE MOST CONSEQUENTIAL LINE ON THE PAGE, AND IT WAS NOT HERE ★
 *
 * The panel below this one says how good the system gets. This one says what it IS, and that is
 * the question a member is actually answering when they choose a build order: two plans with the
 * same tonnage and the same effect totals produce a refinery or an extraction site depending only
 * on which influences outnumber which.
 *
 * It is also the only decision on this page that cannot be undone. A build carrying a fixed
 * economy, placed FIRST, sets the system permanently — eight high-tech installations lose to one
 * industrial opener. Owner's build book for c2-16 opens with a plain colony port for exactly this
 * reason, and until now nothing in the planner would have told anybody why.
 */
function Economy({ plan }: { plan: ColonyPlan }) {
  const { counts, primary, secondary, locked, lockedBy } = plan.simulation.economy;
  if (primary === null) return null;

  const votes = Object.entries(counts);

  return (
    <div className="mt-6 rounded border border-[var(--color-border-hairline)] px-4 py-3">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        What this system becomes
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg text-[var(--color-brand-orange-bright)]">
          {economyName(primary)}
        </span>
        {secondary === null ? null : (
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            with {economyName(secondary)} second
          </span>
        )}
      </div>

      {votes.length === 0 ? null : (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {votes.map(([key, n]) => (
            <span key={key} className="text-[11px] text-[var(--color-text-secondary)]">
              {economyName(key)}{' '}
              <span
                className="font-mono tabular-nums text-[var(--color-text-primary)]"
                title={`${n} build${n === 1 ? '' : 's'} in this order push the system towards ${economyName(key)}.`}
              >
                &times;{n}
              </span>
            </span>
          ))}
        </div>
      )}

      {locked ? (
        <p className="m-0 mt-3 border-l-2 border-[var(--color-semantic-warning)] pl-3 text-[11px] text-[var(--color-text-secondary)]">
          {/*
            Stated as done, not as a risk: by the time a plan opens with this build the outcome is
            settled, and softening it would be the one wording that costs somebody a fortnight.
          */}
          <strong className="text-[var(--color-text-primary)]">
            This economy is locked.
          </strong>{' '}
          <span className="font-mono">{lockedBy}</span> opens the order and permanently fixes the
          system to {economyName(primary)}. Nothing built later can change it, whatever the counts
          above say. To keep the choice open, start with a build that carries no economy of its own
          — a colony port such as <span className="font-mono">plutus</span>,{' '}
          <span className="font-mono">vesta</span> or <span className="font-mono">hestia</span>.
        </p>
      ) : (
        <p className="m-0 mt-3 text-[11px] text-[var(--color-text-dim)]">
          The economy with the most builds behind it becomes the system&rsquo;s primary; the
          runner-up becomes its secondary. Reordering the list above does not change this — only
          adding or removing builds does. One exception: a build that fixes an economy decides it
          outright if it is placed first.
        </p>
      )}
    </div>
  );
}

/**
 * What the system becomes if the whole order is built.
 *
 * ★ LABELLED AS GATHERED, BECAUSE THAT IS WHAT IT IS ★
 *
 * Frontier publishes none of these figures. Every one was measured by players comparing a system
 * before and after a build, and they are the least corroborated numbers on this page — unlike the
 * construction-point costs, which two independent sources agree on. A member deciding how to spend
 * a fortnight is owed that distinction, so it is written next to the numbers rather than buried.
 */
function Effects({ plan }: { plan: ColonyPlan }) {
  const e = plan.simulation.effects;
  const anything = Object.values(e).some((v) => v !== 0);
  if (!anything) return null;

  const rows: Array<[string, number]> = [
    ['Population', e.population],
    ['Max population', e.maxPopulation],
    ['Security', e.security],
    ['Technology', e.technology],
    ['Wealth', e.wealth],
    ['Standard of living', e.standardOfLiving],
    ['Development', e.development],
  ];

  return (
    <div className="mt-6 rounded border border-[var(--color-border-hairline)] px-4 py-3">
      {/*
        "Dropping this plan into the system", not "the plan's effects": the deltas are BEFORE →
        AFTER statements about the system the plan lands in, accrued across the whole build order —
        every step above contributes, and reordering changes when they arrive, not what they sum to.
      */}
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        What dropping this plan into the system does
      </p>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <span key={label} className="text-[11px] text-[var(--color-text-secondary)]">
            {label}{' '}
            <span
              className={
                value < 0
                  ? 'font-mono tabular-nums text-[var(--color-semantic-warning)]'
                  : 'font-mono tabular-nums text-[var(--color-text-primary)]'
              }
              title={`The system's ${label.toLowerCase()} after this plan = what it is now ${value >= 0 ? '+' : '−'} ${Math.abs(value)}.`}
            >
              {value > 0 ? '+' : ''}
              {value}
            </span>
          </span>
        ))}
      </div>
      <p className="m-0 mt-3 text-[11px] text-[var(--color-text-dim)]">
        Each figure is a shift against whatever the system is today, counted cumulatively across
        every step of the build order above. These seven are gathered by players, not published by
        Frontier, and are the least confirmed numbers here — unlike the construction points, which
        two independent sources agree on. A large starport really does cost the system security;
        that is the game, not a mistake.
      </p>
    </div>
  );
}
