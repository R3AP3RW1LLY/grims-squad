/**
 * Turning colonisation journal events into the squadron's own project records.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "keep our own full records too" — said of integrating with Ravencolonial, and then, once shown
 * their API holds nothing we cannot read ourselves: build it self-contained. This job is what makes
 * that true. Without it the tables are empty and a project is a title somebody typed.
 *
 * ★ NO WATERMARK, BECAUSE BOTH HALVES ARE IDEMPOTENT BY CONSTRUCTION ★
 *
 * The obvious design is a cursor: remember which telemetry events have been processed, apply the
 * new ones. It is also the design that goes wrong quietly — a cursor advanced past an event that
 * failed to apply loses it for ever, and a cursor that is not advanced applies everything twice.
 *
 * Neither is needed here, because the two kinds of event have opposite shapes and each is safe on
 * its own terms:
 *
 *   NEEDS          `ColonisationConstructionDepot` reports the site's remaining need for EVERY
 *                  commodity at once. So the newest event is the whole truth: read the latest one
 *                  per project and REPLACE. Running twice writes the same rows; missing a run costs
 *                  nothing, because the next one is just as current. Applying these as deltas would
 *                  drift permanently the first time a member hauled with the app closed.
 *
 *   CONTRIBUTIONS  `ColonisationContribution` is an event, not a state, so it genuinely accumulates
 *                  — and it carries the journal's own idempotency key, which the ledger stores
 *                  UNIQUE. Re-inserting is a no-op at the database level rather than by agreement.
 *
 * The result is a job that can be run at any moment, twice over, or after a week of downtime, and
 * converge on the same answer.
 */

/** A construction depot as the member's journal reported it. */
export interface DepotReading {
  readonly marketId: bigint;
  readonly observedAt: Date;
  readonly complete: boolean;
  readonly failed: boolean;
  readonly resources: ReadonlyArray<{
    readonly commodity: string;
    readonly required: number;
    readonly provided: number;
  }>;
}

/** One delivery, as one commander's journal reported it. */
export interface ContributionReading {
  readonly marketId: bigint;
  readonly userId: string;
  readonly deliveredAt: Date;
  /** The journal's own idempotency key for the event this came from (INV-017). */
  readonly eventKey: string;
  readonly items: ReadonlyArray<{ readonly commodity: string; readonly amount: number }>;
}

/** A project we are tracking, and the site it points at. */
export interface TrackedProject {
  readonly id: string;
  readonly marketId: bigint;
  readonly completedAt: Date | null;
}

export interface NeedRow {
  readonly commodity: string;
  readonly remaining: number;
  readonly required: number | null;
}

export interface ColonyStore {
  /** Every project still worth updating. A finished one is history and is left alone. */
  tracked(): Promise<readonly TrackedProject[]>;
  /** The newest depot reading for a site, from anybody's journal. Null if nobody has docked. */
  latestDepot(marketId: bigint): Promise<DepotReading | null>;
  /** Replaces a project's needs wholesale, in one transaction. */
  replaceNeeds(projectId: string, needs: readonly NeedRow[], observedAt: Date): Promise<void>;
  markComplete(projectId: string, at: Date): Promise<void>;
  /** Every delivery reported for a site. The ledger dedupes by event key. */
  contributionsFor(marketId: bigint): Promise<readonly ContributionReading[]>;
  /** Records one delivery. Returns false when the ledger already held it. */
  recordContribution(
    projectId: string,
    c: ContributionReading,
    item: { commodity: string; amount: number },
  ): Promise<boolean>;
}

export interface ColonyReport {
  readonly projects: number;
  readonly needsUpdated: number;
  readonly contributionsAdded: number;
  readonly completed: number;
  /** Projects nobody has docked at since they were posted, so we hold no needs for them. */
  readonly awaitingFirstVisit: number;
  readonly failed: number;
}

export async function syncColonyProjects(store: ColonyStore): Promise<ColonyReport> {
  const projects = await store.tracked();

  let needsUpdated = 0;
  let contributionsAdded = 0;
  let completed = 0;
  let awaitingFirstVisit = 0;
  let failed = 0;

  for (const project of projects) {
    try {
      const depot = await store.latestDepot(project.marketId);

      if (depot === null) {
        /*
         * Posted, but nobody has docked there since — normal for a project created from a system
         * the member is on their way to. Counted rather than warned about, and the page says
         * "waiting for a visit" rather than showing an empty needs list as though the site needed
         * nothing.
         */
        awaitingFirstVisit += 1;
      } else {
        await store.replaceNeeds(
          project.id,
          depot.resources.map((r) => ({
            commodity: r.commodity,
            // Floored at zero. A site that has been over-delivered reports a negative remainder,
            // and "-40 tonnes still needed" on a progress bar is worse than saying nothing.
            remaining: Math.max(0, r.required - r.provided),
            required: r.required,
          })),
          depot.observedAt,
        );
        needsUpdated += 1;

        /*
         * ★ CLOSED BY THE GAME, NOT BY SOMEBODY REMEMBERING ★
         *
         * A finished build whose card still says "8,940 of 21,620" is how a board stops being
         * trusted. `ConstructionFailed` closes it too: the site is equally gone, and leaving it
         * open would have members hauling to somewhere that no longer exists.
         */
        if ((depot.complete || depot.failed) && project.completedAt === null) {
          await store.markComplete(project.id, depot.observedAt);
          completed += 1;
        }
      }

      /*
       * Contributions are read whether or not a depot reading exists. A member can deliver to a
       * site nobody has read the depot of, and losing their haul because of that ordering would be
       * the single most annoying bug this feature could have.
       */
      for (const c of await store.contributionsFor(project.marketId)) {
        for (const item of c.items) {
          // Zero and negative amounts are skipped rather than stored. The journal has been seen to
          // emit empty contribution entries, and a ledger row of nothing still shows up as a
          // delivery on somebody's tally.
          if (item.amount <= 0) continue;
          if (await store.recordContribution(project.id, c, item)) contributionsAdded += 1;
        }
      }
    } catch {
      /*
       * One project failed. Counted and skipped: the others are independent, and losing every
       * project's update because one member's payload was malformed is the wrong trade.
       */
      failed += 1;
    }
  }

  return {
    projects: projects.length,
    needsUpdated,
    contributionsAdded,
    completed,
    awaitingFirstVisit,
    failed,
  };
}

/**
 * The name to file a commodity under.
 *
 * ★ THE LOCALISED NAME, BECAUSE THAT IS WHAT EVERYTHING ELSE USES ★
 *
 * The journal gives both `$steel_name;` and `Steel`. `market_entries.commodity` holds display
 * names, and the whole point of a project's shopping list is joining its needs against the market
 * to answer "where do I buy this" — so a symbol here would join against nothing and the shopping
 * list would silently come back empty.
 *
 * The fallback cleans the symbol into something readable rather than storing `$steel_name;` raw: a
 * commodity we cannot match is still a commodity a member has to go and find, and a name they can
 * read beats a token they cannot.
 */
export function commodityName(raw: {
  readonly name?: string | null;
  readonly localised?: string | null;
}): string {
  const localised = raw.localised?.trim() ?? '';
  if (localised !== '') return localised;

  const symbol = raw.name?.trim() ?? '';
  if (symbol === '') return '';

  // `$steel_name;` → `Steel`. Frontier's own convention, and stable for years.
  const cleaned = symbol.replace(/^\$/, '').replace(/_name;?$/i, '').replace(/[_;]/g, ' ').trim();
  if (cleaned === '') return symbol;

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
