import type { PrismaClient } from '@grims/db';

/**
 * Reading the commodities market.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "a realt time commodities market that operates similar to uexcorp.space/commodities that shows
 * all the comoditiy details, average pricing, price over time lots of data, as well as the best
 * places to buy both in general and based on the players current location and station they are at."
 *
 * ★ EVERY QUERY HERE RIDES AN INDEX, AND THAT IS NOT A STYLE PREFERENCE ★
 *
 * `market_entries` holds 18.78 million rows and has NO plain index on `commodity`. It has two
 * partial indexes covering exactly the rows that can be traded:
 *
 *   market_entries_buy_idx   (commodity, buy_price ASC)   WHERE supply > 0 AND buy_price > 0
 *   market_entries_sell_idx  (commodity, sell_price DESC) WHERE demand > 0 AND sell_price > 0
 *
 * Measured on our own data: a `count(*)` for one commodity that cannot use them took 72,570ms. The
 * same aggregate that can takes ~250ms, and the "best places to buy" query takes 8ms. A member-
 * facing page cannot be on the wrong side of that, so every WHERE clause below carries the full
 * partial predicate even where it looks redundant — dropping `supply > 0` because `buy_price > 0`
 * seems sufficient is what silently turns an 8ms page into a seventy-second one.
 */

/** One commodity as the market index lists it. Straight off the newest hourly snapshot. */
export interface MarketRow {
  readonly commodity: string;
  readonly category: string | null;
  readonly avgBuy: number | null;
  readonly avgSell: number | null;
  readonly minBuy: number | null;
  readonly maxSell: number | null;
  readonly supply: string;
  readonly demand: string;
  readonly buyMarkets: number;
  readonly sellMarkets: number;
  /** Change in average sell price against the comparison hour, as a fraction. Null when unknown. */
  readonly sellTrend: number | null;
}

/** One station trading one commodity. */
export interface MarketPlace {
  readonly stationName: string;
  readonly systemName: string;
  readonly stationType: string | null;
  readonly largePads: number;
  readonly price: number;
  /** Tonnes available (buying) or wanted (selling). */
  readonly quantity: number;
  readonly seenAt: Date | null;
  /** Light years from the system asked about. Null when no origin was given. */
  readonly distance: number | null;
  /**
   * Where this station is, so it can become the origin of the NEXT leg.
   *
   * The Freight Office plans a run as buy-here then sell-there, and the second query has to be
   * anchored on the first station rather than on where the member started. Null for a station whose
   * coordinates we never learned — which drops it out of leg two rather than measuring from nowhere.
   */
  readonly coords: Coords | null;
}

export interface HistoryPoint {
  readonly observedAt: Date;
  readonly avgBuy: number | null;
  readonly avgSell: number | null;
  readonly minBuy: number | null;
  readonly maxSell: number | null;
  readonly buyMarkets: number;
  readonly sellMarkets: number;
}

export interface MarketStore {
  list(): Promise<readonly MarketRow[]>;
  /** Commodities worth carrying, widest average margin first. Narrows the route search. */
  topMargins(limit: number): Promise<readonly string[]>;
  one(commodity: string): Promise<MarketRow | null>;
  history(commodity: string, hours: number): Promise<readonly HistoryPoint[]>;
  bestBuys(commodity: string, opts: PlaceQuery): Promise<readonly MarketPlace[]>;
  bestSells(commodity: string, opts: PlaceQuery): Promise<readonly MarketPlace[]>;
  /** Coordinates of a system by name, for "near me". Null when we do not hold it. */
  systemCoords(name: string): Promise<Coords | null>;
  /** Systems whose names begin with the fragment, for the origin picker. */
  systemsLike(fragment: string, limit: number): Promise<readonly string[]>;
}

export interface Coords {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlaceQuery {
  readonly limit: number;
  /** Exclude fleet carriers. Default true — see the note on CARRIER_TYPE. */
  readonly excludeCarriers: boolean;
  /** Only stations with a large pad. */
  readonly largePadOnly: boolean;
  /** Ignore prices nobody has reported since this. Null for no limit. */
  readonly seenSince: Date | null;
  /** Rank by distance from here rather than by price alone. */
  readonly near: Coords | null;
  /** Light-year radius, when `near` is set. */
  readonly withinLy: number;
  /** Minimum tonnes on offer or wanted. */
  readonly minQuantity: number;
}

/**
 * Fleet carriers, excluded from the market by default.
 *
 * ★ NOT SNOBBERY — THE NUMBERS ★
 *
 * Carrier owners set prices by hand. In our own data the cheapest Gold in the galaxy is a set of
 * carriers at 2,356 against a station average of 44,758, and the dearest a carrier at 4,760,900.
 * All real, all entered by somebody, and all attached to a station that can be somewhere else
 * tomorrow. Sending a member across the bubble to a carrier that has jumped is the single most
 * expensive mistake this page can make, so they are off by default and one toggle away.
 */
const CARRIER_TYPE = 'Drake-Class Carrier';

/** The two partial-index predicates, written once so no query can drift off the index. */
const BUYABLE = 'supply > 0 AND buy_price > 0';
const SELLABLE = 'demand > 0 AND sell_price > 0';

function int(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export class PrismaMarketStore implements MarketStore {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Every commodity, at the newest hour we recorded, with its movement against a day earlier.
   *
   * One read of `commodity_snapshots`, no join, no touch of `market_entries` at all — which is why
   * it returns in single-digit milliseconds for all 391. The category is denormalised onto the
   * snapshot precisely so this page needs nothing else.
   */
  async list(): Promise<readonly MarketRow[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH newest AS (SELECT max(observed_at) AS at FROM commodity_snapshots),
            -- The most recent hour at least a day old. Not "exactly 24 hours ago": the job may have
            -- missed an hour, and an exact match would silently show no trend at all for everything
            -- rather than comparing against the nearest hour we actually hold.
            prior AS (SELECT max(observed_at) AS at FROM commodity_snapshots
                       WHERE observed_at <= (SELECT at FROM newest) - interval '24 hours')
       SELECT c.commodity, c.category, c.avg_buy, c.avg_sell, c.min_buy, c.max_sell,
              c.supply::text AS supply, c.demand::text AS demand,
              c.buy_markets, c.sell_markets,
              p.avg_sell AS prior_sell
         FROM commodity_snapshots c
         LEFT JOIN commodity_snapshots p
           ON p.commodity = c.commodity AND p.observed_at = (SELECT at FROM prior)
        WHERE c.observed_at = (SELECT at FROM newest)
        ORDER BY c.commodity`,
    );

    return rows.map((r) => this.#row(r));
  }

  async one(commodity: string): Promise<MarketRow | null> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH newest AS (SELECT max(observed_at) AS at FROM commodity_snapshots
                        WHERE commodity = $1),
            prior AS (SELECT max(observed_at) AS at FROM commodity_snapshots
                       WHERE commodity = $1
                         AND observed_at <= (SELECT at FROM newest) - interval '24 hours')
       SELECT c.commodity, c.category, c.avg_buy, c.avg_sell, c.min_buy, c.max_sell,
              c.supply::text AS supply, c.demand::text AS demand,
              c.buy_markets, c.sell_markets,
              (SELECT avg_sell FROM commodity_snapshots
                WHERE commodity = $1 AND observed_at = (SELECT at FROM prior)) AS prior_sell
         FROM commodity_snapshots c
        WHERE c.commodity = $1 AND c.observed_at = (SELECT at FROM newest)`,
      commodity,
    );

    const r = rows[0];
    return r === undefined ? null : this.#row(r);
  }

  #row(r: Record<string, unknown>): MarketRow {
    const sell = int(r['avg_sell']);
    const prior = int(r['prior_sell']);

    return {
      commodity: String(r['commodity']),
      category: r['category'] === null ? null : String(r['category']),
      avgBuy: int(r['avg_buy']),
      avgSell: sell,
      minBuy: int(r['min_buy']),
      maxSell: int(r['max_sell']),
      supply: String(r['supply'] ?? '0'),
      demand: String(r['demand'] ?? '0'),
      buyMarkets: int(r['buy_markets']) ?? 0,
      sellMarkets: int(r['sell_markets']) ?? 0,
      /*
       * Guarded on `prior > 0`, not just on null. A prior hour where nothing traded records a null
       * average, and a zero would divide to Infinity and render as an infinite gain — the shape of
       * bug that looks like a market event rather than a missing row.
       */
      sellTrend: sell !== null && prior !== null && prior > 0 ? (sell - prior) / prior : null,
    };
  }

  async history(commodity: string, hours: number): Promise<readonly HistoryPoint[]> {
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT observed_at, avg_buy, avg_sell, min_buy, max_sell, buy_markets, sell_markets
         FROM commodity_snapshots
        WHERE commodity = $1
          AND observed_at >= now() - make_interval(hours => $2::int)
        ORDER BY observed_at`,
      commodity,
      hours,
    );

    return rows.map((r) => ({
      observedAt: r['observed_at'] as Date,
      avgBuy: int(r['avg_buy']),
      avgSell: int(r['avg_sell']),
      minBuy: int(r['min_buy']),
      maxSell: int(r['max_sell']),
      buyMarkets: int(r['buy_markets']) ?? 0,
      sellMarkets: int(r['sell_markets']) ?? 0,
    }));
  }

  bestBuys(commodity: string, opts: PlaceQuery): Promise<readonly MarketPlace[]> {
    return this.#places(commodity, opts, 'buy');
  }

  bestSells(commodity: string, opts: PlaceQuery): Promise<readonly MarketPlace[]> {
    return this.#places(commodity, opts, 'sell');
  }

  /**
   * Where to buy or sell one commodity.
   *
   * ★ THE 8ms QUERY, AND WHAT KEEPS IT THAT WAY ★
   *
   * Built as one statement against one partial index. The filters below are all applied AFTER the
   * index narrows to a single commodity's tradeable rows — which is a few tens of thousands, small
   * enough that filtering and sorting them costs nothing.
   *
   * The one thing that must never move is the leading `commodity = $1 AND <partial predicate>`. Put
   * anything ahead of it, or drop half the predicate, and the planner falls back to a sequential
   * scan of 18.78 million rows.
   */
  async #places(
    commodity: string,
    opts: PlaceQuery,
    side: 'buy' | 'sell',
  ): Promise<readonly MarketPlace[]> {
    const buying = side === 'buy';
    const priceCol = buying ? 'buy_price' : 'sell_price';
    const qtyCol = buying ? 'supply' : 'demand';
    const predicate = buying ? BUYABLE : SELLABLE;

    const params: unknown[] = [commodity];
    const where: string[] = [`commodity = $1`, predicate];

    if (opts.excludeCarriers) {
      params.push(CARRIER_TYPE);
      // IS DISTINCT FROM, not <>: a station whose type we never learned is NULL, and `<>` would
      // answer NULL for it — dropping every unknown-type station out of the results silently.
      where.push(`station_type IS DISTINCT FROM $${params.length}`);
    }
    if (opts.largePadOnly) where.push(`large_pads > 0`);
    if (opts.minQuantity > 0) {
      params.push(opts.minQuantity);
      where.push(`${qtyCol} >= $${params.length}`);
    }
    if (opts.seenSince !== null) {
      params.push(opts.seenSince);
      where.push(`market_seen_at >= $${params.length}`);
    }

    /*
     * Distance is computed with the cube operator against the GiST index. `<->` is the operator
     * that index supports; computing it by hand in SQL would work and would scan.
     */
    let distanceSelect = 'NULL::float8 AS distance';
    let order = buying ? `buy_price ASC` : `sell_price DESC`;

    if (opts.near !== null) {
      params.push(opts.near.x, opts.near.y, opts.near.z);
      const origin = `cube(ARRAY[$${params.length - 2}::float8,$${params.length - 1}::float8,$${params.length}::float8])`;
      distanceSelect = `(coords <-> ${origin}) AS distance`;
      params.push(opts.withinLy);
      where.push(`coords IS NOT NULL AND (coords <-> ${origin}) <= $${params.length}`);
      /*
       * Price still leads inside the radius. Sorting by distance first answers "what is nearest",
       * which is not the question — a member asking where to buy within 50 light years wants the
       * best price in that circle, and every result is already close enough by construction.
       */
      order = buying ? `buy_price ASC, distance ASC` : `sell_price DESC, distance ASC`;
    }

    params.push(opts.limit);

    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT station_name, system_name, station_type, large_pads,
              ${priceCol} AS price, ${qtyCol} AS quantity, market_seen_at, ${distanceSelect},
              cube_ll_coord(coords, 1) AS cx,
              cube_ll_coord(coords, 2) AS cy,
              cube_ll_coord(coords, 3) AS cz
         FROM market_entries
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT $${params.length}`,
      ...params,
    );

    return rows.map((r) => ({
      stationName: String(r['station_name']),
      systemName: String(r['system_name']),
      stationType: r['station_type'] === null ? null : String(r['station_type']),
      largePads: int(r['large_pads']) ?? 0,
      price: int(r['price']) ?? 0,
      quantity: int(r['quantity']) ?? 0,
      seenAt: (r['market_seen_at'] as Date | null) ?? null,
      distance: r['distance'] === null ? null : Number(r['distance']),
      coords:
        r['cx'] === null || r['cy'] === null || r['cz'] === null
          ? null
          : { x: Number(r['cx']), y: Number(r['cy']), z: Number(r['cz']) },
    }));
  }

  /**
   * The commodities worth carrying at all, widest margin first.
   *
   * ★ THIS IS WHAT MAKES ROUTE PLANNING AFFORDABLE ★
   *
   * The obvious way to plan a route is to join buy-side against sell-side across every commodity at
   * once. That was tried on 2026-07-31 and a four-way self-join over this data spilled to temp until
   * it exhausted the disk and took the whole Docker engine down — the reason `market_entries` exists
   * as a flat table in the first place.
   *
   * So the search is narrowed BEFORE any station work happens, using the hourly rollup: 391 rows,
   * already aggregated, read in two milliseconds. Carrying something with a two-credit margin is
   * never the answer, so the planner only ever does expensive per-station work for commodities that
   * could plausibly pay for the trip.
   */
  async topMargins(limit: number): Promise<readonly string[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ commodity: string }>>(
      `SELECT commodity
         FROM commodity_snapshots
        WHERE observed_at = (SELECT max(observed_at) FROM commodity_snapshots)
          AND avg_buy IS NOT NULL AND avg_sell IS NOT NULL
          -- Both sides have to be genuinely tradeable. A commodity stocked at four markets in the
          -- galaxy has a wonderful margin and no route.
          AND buy_markets >= 20 AND sell_markets >= 20
        ORDER BY (avg_sell - avg_buy) DESC
        LIMIT $1`,
      limit,
    );
    return rows.map((r) => r.commodity);
  }

  async systemCoords(name: string): Promise<Coords | null> {
    /*
     * From our own galaxy data rather than from `market_entries`, so a system with no market still
     * works as an origin — which is most of them, and exactly where a member asking "what is near
     * me" is likely to be sitting.
     *
     * ★ THE COORDINATES ARE A `cube` COLUMN, NOT JSON — COST A SILENT BUG ★
     *
     * The first version read `data->'coords'->>'x'`, which is a perfectly reasonable guess and is
     * NULL for every system in the table: the ingest writes coordinates to the `coords` column so
     * the GiST index can use them, and `data` never carries them.
     *
     * It failed silently and in the worst possible direction. `systemCoords` returned null, the
     * caller read that as "no origin given", and a member asking for the best price WITHIN 50 LIGHT
     * YEARS was quietly handed the best price in the galaxy — a correct-looking answer, a station
     * they could not reach, and nothing anywhere saying so. Whoever changes this next: keep the
     * caller's "unknown system" and "no system asked for" cases distinct.
     */
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT cube_ll_coord(coords, 1) AS x,
              cube_ll_coord(coords, 2) AS y,
              cube_ll_coord(coords, 3) AS z
         FROM knowledge_items
        WHERE source = 'galaxy' AND kind = 'system' AND lower(name) = lower($1)
          AND coords IS NOT NULL
        LIMIT 1`,
      name,
    );

    const r = rows[0];
    if (r === undefined || r['x'] === null || r['y'] === null || r['z'] === null) return null;
    return { x: Number(r['x']), y: Number(r['y']), z: Number(r['z']) };
  }

  async systemsLike(fragment: string, limit: number): Promise<readonly string[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM knowledge_items
        WHERE source = 'galaxy' AND kind = 'system' AND name ILIKE $1
        ORDER BY length(name), name
        LIMIT $2`,
      `${fragment}%`,
      limit,
    );
    return rows.map((r) => r.name);
  }
}
