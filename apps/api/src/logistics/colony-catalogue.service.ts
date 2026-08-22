import type { PrismaClient } from '@grims/db';
import type { MarketStore } from './market.store.js';

/**
 * The build catalogue, read.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "ensure our baseline colonization setup we have now meets and exceeds the current feature and
 * system of raven colonial."
 *
 * The table exists and until now nothing could see it. This is what answers "what does a Coriolis
 * cost" before anybody has flown anywhere — which is the question worth asking while you are still
 * deciding, and the one a project page could never answer because a project has no needs until
 * somebody docks at it.
 */

/** What a completed build of this kind does to its system — the seven Raven-style scalars. */
export interface BuildTypeEffects {
  readonly population: number;
  readonly maxPopulation: number;
  readonly security: number;
  readonly technology: number;
  readonly wealth: number;
  readonly standardOfLiving: number;
  readonly development: number;
}

export interface BuildTypeRow {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly tier: number;
  readonly location: 'orbital' | 'surface';
  readonly padSize: 'none' | 'small' | 'medium' | 'large';
  /** Which tier of point this build spends, and how many. Zero for a tier-1 build. */
  readonly needsTier: number;
  readonly needsPoints: number;
  readonly totalTonnes: number;
  readonly commodities: number;
  /**
   * `community` or `observed`.
   *
   * Shown rather than hidden. Frontier publishes none of these figures, so every one of them is
   * either somebody's gathered number or a measurement from one of our own builds — and a reader
   * deciding whether to commit a fortnight of hauling to a plan deserves to know which.
   */
  readonly source: 'community' | 'observed';
  readonly confirmations: number;
  /**
   * What finishing one does to the system.
   *
   * ★ THE COLUMNS WERE THERE AND THE PAGES COULD NOT SEE THEM ★
   *
   * The seven eff_* scalars have been seeded for all fifty-five types since the simulation
   * shipped, summed on every plan — and absent from this row, so a member PICKING a type had to
   * add one to a plan to find out what it does. Community-measured, like everything here; the
   * pages say so where they print them.
   */
  readonly effects: BuildTypeEffects;
  /** What it feeds the port that receives it. `none` for the many that feed nothing. */
  readonly economyInfluence: string;
  /** Set when the build's OWN economy is locked regardless of surroundings. */
  readonly economyFixed: string | null;
}

export interface BuildCostLine {
  readonly commodity: string;
  readonly tonnes: number;
  /** Best price found near the origin, or null when nobody in range sells it. */
  readonly price: number | null;
  readonly stationName: string | null;
  readonly systemName: string | null;
  readonly distance: number | null;
  readonly cost: number | null;
}

export interface BuildTypeDetail extends BuildTypeRow {
  readonly layouts: readonly string[];
  readonly costs: readonly BuildCostLine[];
  /** Total credits for everything that could be priced. */
  readonly total: number;
  /** How many lines nobody in range sells, so the total can be qualified rather than trusted. */
  readonly unsourced: number;
}

/**
 * How many commodities to price at once.
 *
 * Eight, not twenty-three. The whole build in one go would open a connection per commodity and
 * fight the pool the rest of the API is using — to save time nobody can perceive past the first
 * batch, since three batches of eight is already a few hundred milliseconds.
 */
const PRICE_BATCH = 8;

/**
 * How long a priced build stays good for.
 *
 * ★ THE SAME ANSWER, COMPUTED OVER AND OVER — MEASURED 2026-08-05 ★
 *
 * Members reported "The hub did not answer in time" from the companion app, and the hub was
 * answering — in three to seven seconds. Every one of the slow requests was this: a project's
 * priced shopping list, twenty market lookups against 18.8 million rows.
 *
 * Nothing about the query was wrong. The volume was. The companion polls a project page every
 * sixty seconds, so five members watching one build is a hundred of those lookups a minute, all
 * returning the same answer — market prices move on the EDDN relay's pace and the nightly rebuild,
 * not between two polls a minute apart.
 *
 * Sixty seconds is deliberately the app's own cadence: a member who refreshes gets fresh work at
 * most once per poll, and every other reader of the same build rides on it. It cannot serve
 * anything a member would call stale, because a minute ago is where the previous poll already was.
 *
 * ★ WHY NOT MAKE THE QUERY FASTER INSTEAD ★
 *
 * Because it is already right. `market.store.ts` carries a measurement showing that removing its
 * second sort key takes it from 202 ms to THIRTY-SIX SECONDS — the ordering is load-bearing and
 * the obvious optimisations are the trap. Recomputing less is the honest lever.
 */
const PRICED_TTL_MS = 60_000;

/** Bounded so a long-lived process cannot accumulate one entry per (build, origin) for ever. */
const PRICED_MAX_ENTRIES = 200;

export class ColonyCatalogueService {
  /*
   * Keyed on the build AND the origin, because "cheapest near me" is a different answer for every
   * member — caching on the build alone would hand somebody in Sol a price from somebody else's
   * corner of the bubble, which is precisely the number this page must never invent.
   *
   * In-process, not Redis: it is worth exactly one minute, it costs nothing to lose on a deploy,
   * and a second store to keep correct would be more moving parts than the problem deserves.
   */
  readonly #priced = new Map<string, { at: number; value: BuildTypeDetail | null }>();
  constructor(
    private readonly db: PrismaClient,
    private readonly market: MarketStore,
  ) {}

  /** Every build type, biggest haul last — the order somebody scanning for "what can I afford" wants. */
  async list(): Promise<readonly BuildTypeRow[]> {
    const rows = await this.db.$queryRawUnsafe<Array<CatalogueRowRecord>>(
      `SELECT b.id, b.display_name, b.category, b.tier, b.location, b.pad_size,
              b.total_tonnes, b.source, b.confirmations,
              b.eff_population, b.eff_max_population, b.eff_security, b.eff_technology,
              b.eff_wealth, b.eff_standard_of_living, b.eff_development,
              b.economy_influence, b.economy_fixed,
              -- What a build SPENDS. Sent so the picker can say "needs 3 T2 — only 1 banked" beside
              -- the option, instead of the planner catching it after the site has been added.
              b.needs_tier, b.needs_points,
              count(c.commodity) AS commodities
         FROM colony_build_types b
         LEFT JOIN colony_build_costs c ON c.build_type_id = b.id
        GROUP BY b.id
        ORDER BY b.tier, b.total_tonnes`,
    );

    return rows.map((r) => this.#row(r));
  }

  /**
   * One build type, priced.
   *
   * ★ ONE QUERY PER COMMODITY, RUN IN PARALLEL ★
   *
   * A build wants around twenty commodities and each needs its own indexed lookup against 18.78M
   * market rows. There is no cheaper shape that still answers "where would I actually buy this".
   *
   * Measured sequentially it was 2.2 seconds warm and 7.4 cold, because ordering by distance means
   * computing a distance for every matching row and sorting them — about 95ms a commodity, not the
   * 8ms a price-ordered lookup costs. The queries do not depend on each other, so waiting for each
   * one before starting the next was pure wall-clock. In batches it is a few hundred milliseconds.
   *
   * Batched rather than all at once: twenty-three simultaneous connections would fight the pool
   * that the rest of the API is using, to save time nobody can perceive past the first batch.
   *
   * `near` absent means no prices at all rather than galaxy-wide ones. A cheapest-anywhere figure
   * would be a number nobody can act on, and worse, would look like a real quote.
   */
  async byId(id: string, near: { x: number; y: number; z: number } | null): Promise<BuildTypeDetail | null> {
    /*
     * Rounded to whole light years. A member drifting in supercruise moves a few hundred metres
     * between polls, and keying on raw coordinates would miss the cache every single time while
     * looking like it was working — the worst kind of cache, which costs memory and saves nothing.
     */
    const key =
      near === null
        ? `${id}|nowhere`
        : `${id}|${Math.round(near.x)},${Math.round(near.y)},${Math.round(near.z)}`;

    const hit = this.#priced.get(key);
    if (hit !== undefined && Date.now() - hit.at < PRICED_TTL_MS) return hit.value;

    const value = await this.#priceById(id, near);

    // Oldest out first, so the map cannot grow without bound on a process that runs for weeks.
    if (this.#priced.size >= PRICED_MAX_ENTRIES) {
      const oldest = this.#priced.keys().next();
      if (!oldest.done) this.#priced.delete(oldest.value);
    }
    this.#priced.set(key, { at: Date.now(), value });
    return value;
  }

  async #priceById(
    id: string,
    near: { x: number; y: number; z: number } | null,
  ): Promise<BuildTypeDetail | null> {
    const [head] = await this.db.$queryRawUnsafe<
      Array<Omit<CatalogueRowRecord, 'commodities'> & { layouts: string[] }>
    >(
      `SELECT id, display_name, category, tier, location, pad_size, total_tonnes,
              layouts, source, confirmations,
              eff_population, eff_max_population, eff_security, eff_technology,
              eff_wealth, eff_standard_of_living, eff_development,
              economy_influence, economy_fixed
         FROM colony_build_types WHERE id = $1`,
      id,
    );

    if (head === undefined) return null;

    const costs = await this.db.$queryRawUnsafe<Array<{ commodity: string; tonnes: number }>>(
      `SELECT commodity, tonnes FROM colony_build_costs
        WHERE build_type_id = $1 ORDER BY tonnes DESC`,
      id,
    );

    const priceOne = async (line: { commodity: string; tonnes: number }): Promise<BuildCostLine> => {
      const place =
        near === null
          ? undefined
          : (
              await this.market
                .bestBuys(line.commodity, {
                  limit: 1,
                  // Carriers off: a plan for a trip must not point at something that has jumped
                  // away by the time somebody flies there.
                  excludeCarriers: true,
                  largePadOnly: false,
                  seenSince: null,
                  withinLy: 100,
                  minQuantity: 1,
                  near,
                  // Nearest first, then price. A build is hauled, so the trip is the cost that
                  // matters — the same reasoning the project shopping list now uses.
                  order: 'distance',
                })
                .catch(() => [])
            )[0];

      return {
        commodity: line.commodity,
        tonnes: line.tonnes,
        price: place?.price ?? null,
        stationName: place?.stationName ?? null,
        systemName: place?.systemName ?? null,
        distance: place?.distance ?? null,
        cost: place === undefined ? null : place.price * line.tonnes,
      };
    };

    const lines: BuildCostLine[] = [];
    for (let i = 0; i < costs.length; i += PRICE_BATCH) {
      lines.push(...(await Promise.all(costs.slice(i, i + PRICE_BATCH).map(priceOne))));
    }

    let total = 0;
    let unsourced = 0;
    for (const line of lines) {
      if (line.cost === null) unsourced += 1;
      else total += line.cost;
    }

    return {
      ...this.#row({ ...head, commodities: BigInt(costs.length) }),
      layouts: head.layouts,
      costs: lines,
      total,
      unsourced,
    };
  }

  #row(r: CatalogueRowRecord): BuildTypeRow {
    return {
      id: r.id,
      displayName: r.display_name,
      category: r.category,
      tier: r.tier,
      location: r.location === 'surface' ? 'surface' : 'orbital',
      padSize: (['none', 'small', 'medium', 'large'] as const).includes(
        r.pad_size as 'none' | 'small' | 'medium' | 'large',
      )
        ? (r.pad_size as 'none' | 'small' | 'medium' | 'large')
        : 'none',
      totalTonnes: r.total_tonnes,
      needsTier: Number(r.needs_tier ?? 0),
      needsPoints: Number(r.needs_points ?? 0),
      commodities: Number(r.commodities),
      source: r.source === 'observed' ? 'observed' : 'community',
      confirmations: r.confirmations,
      effects: {
        population: r.eff_population,
        maxPopulation: r.eff_max_population,
        security: r.eff_security,
        technology: r.eff_technology,
        wealth: r.eff_wealth,
        standardOfLiving: r.eff_standard_of_living,
        development: r.eff_development,
      },
      economyInfluence: r.economy_influence,
      economyFixed: r.economy_fixed,
    };
  }
}

/** One catalogue row as the SQL returns it. Shared by the list and the head read. */
interface CatalogueRowRecord {
  id: string;
  display_name: string;
  category: string;
  tier: number;
  location: string;
  pad_size: string;
  total_tonnes: number;
  needs_tier: number | null;
  needs_points: number | null;
  commodities: bigint;
  source: string;
  confirmations: number;
  eff_population: number;
  eff_max_population: number;
  eff_security: number;
  eff_technology: number;
  eff_wealth: number;
  eff_standard_of_living: number;
  eff_development: number;
  economy_influence: string;
  economy_fixed: string | null;
}
