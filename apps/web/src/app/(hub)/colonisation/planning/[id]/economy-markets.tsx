import type { ColonyPlan } from '../../../../../lib/api';

/**
 * What the system BECOMES, and what its markets would then trade.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * Asked for suggestions across the colonisation pages, and chose "three tabs" for the plan: The
 * system / Build order / Economy & markets.
 *
 * ★ WHY THIS WAS THE RIGHT SPLIT ★
 *
 * These two panels were rendered at the BOTTOM of the build-order tab, under an editable list that
 * runs to eighty-one rows on the owner's own plan. The most consequential fact on the page — what
 * the system permanently becomes — sat below a fortnight of scrolling, on a tab about the order to
 * do things in.
 *
 * They are not an ordering question. The economy is decided by WHICH builds are in the plan, not by
 * their sequence — the panel below says so in as many words ("Reordering the list above does not
 * change this") — so it was answering a question the tab it lived on could not ask.
 *
 * ★ AND THE ORDER OF THE TWO IS DELIBERATE ★
 *
 * What it becomes before how good it gets: the economy is the decision, the scalars grade it.
 */
export function EconomyAndMarkets({ plan }: { plan: ColonyPlan }) {
  const nothingYet =
    plan.simulation.economy.primary === null &&
    !Object.values(plan.simulation.effects).some((v) => v !== 0);

  if (nothingYet) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        Nothing to work out yet. Choose builds for the bodies on the system tab and what the system
        becomes — and what its markets would trade — is worked out from them.
      </p>
    );
  }

  return (
    <div>
      <Economy plan={plan} />
      <Effects plan={plan} />
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
    <div className="rounded border border-[var(--color-border-hairline)] px-4 py-3">
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
          <strong className="text-[var(--color-text-primary)]">This economy is locked.</strong>{' '}
          <span className="font-mono">{lockedBy}</span> opens the order and permanently fixes the
          system to {economyName(primary)}. Nothing built later can change it, whatever the counts
          above say. To keep the choice open, start with a build that carries no economy of its own
          — a colony port such as <span className="font-mono">plutus</span>,{' '}
          <span className="font-mono">vesta</span> or <span className="font-mono">hestia</span>.
        </p>
      ) : (
        <p className="m-0 mt-3 text-[11px] text-[var(--color-text-dim)]">
          {/*
            "the build order" rather than "the list above" — the list is on a different tab now, and
            a sentence pointing at something that is not on screen reads as a broken page.
          */}
          The economy with the most builds behind it becomes the system&rsquo;s primary; the
          runner-up becomes its secondary. Changing the build ORDER does not affect this — only
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
        every step contributes, and reordering changes when they arrive, not what they sum to.
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
        every step of the build order. These seven are gathered by players, not published by
        Frontier, and are the least confirmed numbers here — unlike the construction points, which
        two independent sources agree on. A large starport really does cost the system security;
        that is the game, not a mistake.
      </p>
    </div>
  );
}
