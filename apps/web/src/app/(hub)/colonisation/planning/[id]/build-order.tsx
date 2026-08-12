'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ColonyPlan, PlanProblem, PlanSimStep } from '../../../../../lib/api';
import { apiPatch } from '../../../../../lib/api-client';
import { siteProgress } from '@grims/shared/colony-plan-progress';
import { PlanReview } from './plan-review';

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

  /** Every order change goes through one save, so the failure path is one path. */
  const save = async (ids: readonly string[]): Promise<void> => {
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

  const move = async (from: number, to: number): Promise<void> => {
    const ids = plan.sites.map((s) => s.id);
    const moved = ids[from];
    if (moved === undefined || to < 0 || to >= ids.length) return;

    ids.splice(from, 1);
    ids.splice(to, 0, moved);
    await save(ids);
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

      {/*
        Directly under the verdict, because that is where "what is wrong with this plan" already
        lives. The verdict lists the problems; this explains which one will cost the most.
      */}
      <PlanReview planId={plan.id} />

      <Suggestion
        plan={plan}
        canEdit={canEdit}
        busy={busy}
        onApply={(ids) => void save(ids)}
      />

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
                  {/*
                    ★ WHAT HAS ACTUALLY BEEN BUILT — SQUADRON OWNER, 2026-08-11 ★

                    Three states, not two: a project posted an hour ago with nothing delivered is
                    NOT built, and counting it as built would overstate the number somebody plans a
                    fortnight around. A site with no project stays silent rather than being labelled
                    "planned" eighty-one times over.
                  */}
                  {progress.state === 'complete' ? (
                    <a
                      href={s.projectId === null ? undefined : `/colonisation/${s.projectId}`}
                      className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-semantic-success)] no-underline hover:underline"
                    >
                      built
                    </a>
                  ) : progress.state === 'building' ? (
                    <a
                      href={s.projectId === null ? undefined : `/colonisation/${s.projectId}`}
                      className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-brand-cyan-bright)] no-underline hover:underline"
                    >
                      building
                      {progress.hauled === null || progress.total === 0
                        ? null
                        : ` ${Math.round((progress.hauled / progress.total) * 100)}%`}
                    </a>
                  ) : progress.state === 'started' ? (
                    /*
                      ★ STARTED IS NOT BUILDING — SQUADRON OWNER, 2026-08-11 ★

                      "we should aslo make a way to denote started, in progress and complete etc."

                      A site posted with nothing delivered needs somebody to fly the FIRST load; one
                      at 38% already has a hauler. Before this they read identically, and the row
                      that most needs a volunteer was indistinguishable from the one that has one.
                    */
                    <a
                      href={s.projectId === null ? undefined : `/colonisation/${s.projectId}`}
                      className="ml-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-semantic-warning)] no-underline hover:underline"
                    >
                      started · nothing hauled
                    </a>
                  ) : null}
                </span>

                <span className="flex items-center gap-3">
                  <Cost step={step} />
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
                    {/*
                      A site that has been posted reports its OWN tonnage off a commander's journal.
                      That figure beats the catalogue's guess, and where hauling has started the
                      remaining is what somebody actually has to fly.
                    */}
                    {progress.measured && (progress.state === 'building' || progress.state === 'started')
                      ? `${progress.remaining.toLocaleString()} t left`
                      : s.totalTonnes === null
                        ? '—'
                        : `${s.totalTonnes.toLocaleString()} t`}
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

      {/*
        The economy and the system effects used to render here, below an editable list that runs to
        eighty-one rows on the owner's own plan. They are not an ordering question — the economy is
        decided by WHICH builds are in the plan, not their sequence — so they moved to their own tab.
        See economy-markets.tsx.
      */}
    </div>
  );
}

/**
 * A better order, when there is one.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "you have an editable order, but nothing suggests the feeder→hub pairing that would get your
 * economy producing after ~50k t instead of ~257k t. That's a real gap inside a feature that exists."
 *
 * ★ THE NUMBER IS THE WHOLE ARGUMENT ★
 *
 * "A better order" persuades nobody. "Your economy opens 240,000 tonnes earlier" is a decision
 * somebody can actually make, so the tonnage is the headline and the ordering is the detail.
 *
 * ★ IT STAYS QUIET WHEN THERE IS NOTHING TO SAY ★
 *
 * `worthIt` is false when the order is already good, when there is no economy build to bring
 * forward, and when the saving is under ten thousand tonnes. A panel that always has advice is one
 * people stop reading, and this sits directly above a list somebody is trying to use.
 *
 * ★ AND IT NEVER APPLIES ITSELF ★
 *
 * One button, pressed on purpose, sending the same whole-order save the arrows send. A member's own
 * order can encode things this cannot see — a body they want finished first, a carrier already
 * parked somewhere — and a planner that silently rearranged a fortnight of hauling is one nobody
 * trusts twice.
 */
function Suggestion({
  plan,
  canEdit,
  busy,
  onApply,
}: {
  plan: ColonyPlan;
  canEdit: boolean;
  busy: boolean;
  onApply: (ids: readonly string[]) => void;
}) {
  const s = plan.suggestion;
  if (s === undefined || !s.worthIt) return null;

  const saved = s.tonnesBefore.current - s.tonnesBefore.suggested;
  const at = s.firstEconomyAt.suggested;
  if (at === null) return null;

  return (
    <div className="mb-4 rounded border border-[var(--color-brand-cyan)] bg-[color-mix(in_srgb,var(--color-brand-cyan)_6%,transparent)] px-3 py-2">
      <p className="m-0 text-sm text-[var(--color-text-primary)]">
        Your economy could open{' '}
        <span className="font-mono tabular-nums text-[var(--color-brand-cyan-bright)]">
          {saved.toLocaleString()} t
        </span>{' '}
        earlier.
      </p>
      <p className="m-0 mt-1 text-[11px] text-[var(--color-text-secondary)]">
        {/*
          Both figures, because the saving alone is a claim and the pair is a comparison somebody can
          check against the list right below this.
        */}
        The first economy build currently lands at step{' '}
        {(s.firstEconomyAt.current ?? plan.sites.length) + 1} after{' '}
        {s.tonnesBefore.current.toLocaleString()} t of hauling. Pairing each feeder with the hub it
        pays for puts one at step {at + 1}, after {s.tonnesBefore.suggested.toLocaleString()} t —
        so the system starts producing what the rest of the build has to buy. The primary port stays
        where you put it.
      </p>

      {canEdit ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply(s.order)}
          className="mt-2 rounded-md border border-[var(--color-brand-cyan)] px-3 py-1 text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand-cyan)_14%,transparent)] disabled:opacity-50"
        >
          {busy ? 'Reordering…' : 'Reorder the plan this way'}
        </button>
      ) : null}
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

