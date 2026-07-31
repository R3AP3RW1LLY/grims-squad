import type { PrismaClient } from '@grims/db';

/**
 * Keeping station markets current from members' own journals.
 *
 * ★ WHY LIVE UPDATES BEAT THE NIGHTLY DUMP WHERE IT MATTERS MOST ★
 *
 * Spansh rebuilds once a night, so a price can be twenty-four hours old — and the routes worth
 * flying are precisely the ones that drain fastest. A member who lifts 1,040 tonnes of Platinum has
 * just emptied the stock the next member would be routed straight to.
 *
 * Their journal already told us. This applies it.
 *
 * ★ THREE EVENTS, IN DESCENDING ORDER OF VALUE ★
 *
 *   Market      the station's full commodity list, written whenever somebody opens the market
 *               screen. A complete, authoritative refresh of one station — better than the dump can
 *               give, because it is what the game showed a commander seconds ago.
 *   MarketBuy   a member took N tonnes off the station. Supply drops by N.
 *   MarketSell  a member delivered N tonnes. Demand drops by N.
 *
 * The deltas are approximations: other commanders trade the same stations and we see none of it.
 * They are still far closer to the truth than a figure from last night, and the next `Market` event
 * from anybody at all corrects the accumulated drift completely.
 *
 * ★ THIS LAYERS OVER THE NIGHTLY REBUILD, IT DOES NOT REPLACE IT ★
 *
 * `rebuildMarketEntries` truncates and repopulates from the dump. Live edits made since are lost at
 * that point, which is correct — the dump is a fresh observation of every station, including the
 * ones no member has visited. Live updates fill the day between rebuilds; the rebuild resets the
 * baseline.
 */

/** Binds the functions below to a client. See `MarketUpdater` in the ingest service. */
export class PrismaMarketUpdater {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async apply(event: Record<string, unknown> & { event: string }): Promise<number> {
    return applyMarketEvent(this.#db, event as MarketEvent);
  }
}

/** What a journal event has to carry for us to be able to use it. */
export interface MarketEvent {
  readonly event: string;
  /** Frontier's market identifier — the ONLY thing tying a journal event to a station. */
  readonly MarketID?: unknown;
  readonly Type_Localised?: unknown;
  readonly Type?: unknown;
  readonly Count?: unknown;
  readonly Items?: unknown;
}

/** A station we were able to resolve a MarketID to. */
interface Station {
  readonly key: string;
  readonly name: string;
  readonly system: string;
  readonly type: string | null;
  readonly pads: number;
}

/**
 * Applies one journal event to the market table.
 *
 * Returns how many rows changed, so a caller can report that live updates are actually doing
 * something rather than silently matching nothing — which is exactly what a missing `marketId`
 * would have looked like.
 */
export async function applyMarketEvent(db: PrismaClient, ev: MarketEvent): Promise<number> {
  /*
   * Frontier writes MarketID as a number, but a journal that has been through JSON round-trips
   * elsewhere can carry it as a string. Both are accepted; anything else is not a market event we
   * can place.
   */
  const marketId =
    typeof ev.MarketID === 'number'
      ? ev.MarketID
      : typeof ev.MarketID === 'string' && /^\d+$/.test(ev.MarketID)
        ? Number(ev.MarketID)
        : null;
  if (marketId === null) return 0;

  if (ev.event === 'Market') return applySnapshot(db, marketId, ev.Items);
  if (ev.event === 'MarketBuy') return applyDelta(db, marketId, ev, 'supply');
  if (ev.event === 'MarketSell') return applyDelta(db, marketId, ev, 'demand');
  return 0;
}

/**
 * A full market snapshot — the best update available from any source.
 *
 * ★ IT REPLACES THE STATION'S ROWS RATHER THAN MERGING THEM ★
 *
 * The event lists everything the station trades right now. A commodity present in our table but
 * absent from the event is one the station has STOPPED trading, and merging would leave that row
 * behind indefinitely — routing members to sell a cargo hold of something nobody there buys.
 */
async function applySnapshot(db: PrismaClient, marketId: number, items: unknown): Promise<number> {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const rows = items
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      /*
       * `Name_Localised` is the display name ("Platinum"); `Name` is the internal symbol
       * ("$platinum_name;"). Our entries are keyed on the display name, because that is what Spansh
       * stores and what a member types into a search box. Falling back to a cleaned-up symbol keeps
       * the handful of commodities Frontier ships without a localised name usable.
       */
      const name =
        typeof i['Name_Localised'] === 'string' && i['Name_Localised'] !== ''
          ? i['Name_Localised']
          : symbolToName(i['Name']);
      if (name === null) return null;

      return {
        name,
        category: typeof i['Category_Localised'] === 'string' ? i['Category_Localised'] : null,
        buy: numberOr(i['BuyPrice'], 0),
        sell: numberOr(i['SellPrice'], 0),
        supply: numberOr(i['Stock'], 0),
        demand: numberOr(i['Demand'], 0),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return 0;

  const station = await stationFor(db, marketId);
  if (station === null) return 0;

  /*
   * Delete and insert inside ONE transaction. Between the two statements the station has no market
   * rows at all, and a route query running in that window would report the station trades nothing —
   * a wrong answer rather than a stale one.
   */
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM market_entries WHERE station_key = $1`, station.key);

    const values: string[] = [];
    const params: unknown[] = [station.key, station.name, station.system, station.type, station.pads];

    for (const r of rows) {
      const i = params.length;
      params.push(r.name, r.category, r.buy, r.sell, r.supply, r.demand);
      values.push(
        `($1,$2,$3,$4,` +
          // Coordinates come from the station's own knowledge row: the journal does not carry them,
          // and a NULL here would drop the station out of every "within N light years" search.
          `(SELECT coords FROM knowledge_items WHERE source='galaxy' AND kind='station' AND ext_key=$1),` +
          `$5,$${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},now())`,
      );
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO market_entries (station_key, station_name, system_name, station_type, coords,
                                   large_pads, commodity, category, buy_price, sell_price,
                                   supply, demand, market_seen_at)
       VALUES ${values.join(',')}`,
      ...params,
    );

    return rows.length;
  });
}

/**
 * A buy or a sell: adjust one commodity's quantity at one station.
 *
 * ★ NEVER BELOW ZERO ★
 *
 * We observe only our own members' trades. If other commanders have already drained a station, our
 * subtraction can overshoot — and a negative supply sorts to the very top of "cheapest source",
 * routing somebody across the bubble to an empty pad. `GREATEST(0, ...)` makes the worst case
 * "we think it is empty", which is both closer to true and harmless.
 */
async function applyDelta(
  db: PrismaClient,
  marketId: number,
  ev: MarketEvent,
  column: 'supply' | 'demand',
): Promise<number> {
  const name =
    typeof ev.Type_Localised === 'string' && ev.Type_Localised !== ''
      ? ev.Type_Localised
      : symbolToName(ev.Type);
  const count = numberOr(ev.Count, 0);
  if (name === null || count <= 0) return 0;

  const station = await stationFor(db, marketId);
  if (station === null) return 0;

  /*
   * `market_seen_at` is NOT advanced here.
   *
   * That column means "when was this price last observed", and a buy tells us nothing about the
   * price — only about the quantity. Stamping it would make a day-old price look freshly confirmed,
   * which is the opposite of what a member comparing two stations needs to know.
   */
  return db.$executeRawUnsafe(
    `UPDATE market_entries
        SET ${column} = GREATEST(0, ${column} - $3)
      WHERE station_key = $1 AND commodity = $2`,
    station.key,
    name,
    count,
  );
}

/**
 * Finds the station a MarketID belongs to.
 *
 * Null when we have never ingested it — a brand new station, a fleet carrier that has jumped in
 * since the last dump, or one Spansh has not seen. That is a NORMAL state and not an error: the
 * next nightly ingest introduces it, and until then there is nothing to update.
 */
async function stationFor(db: PrismaClient, marketId: number): Promise<Station | null> {
  const rows = await db.$queryRawUnsafe<
    Array<{ ext_key: string; name: string; system: string | null; type: string | null; pads: number }>
  >(
    `SELECT ext_key, name,
            data->>'system' AS system,
            data->>'type'   AS type,
            COALESCE((data->'landingPads'->>'large')::int, 0) AS pads
       FROM knowledge_items
      WHERE source = 'galaxy' AND kind = 'station'
        AND data->>'marketId' = $1
      LIMIT 1`,
    String(marketId),
  );

  const r = rows[0];
  if (r === undefined) return null;

  return {
    key: r.ext_key,
    name: r.name,
    system: r.system ?? '',
    type: r.type,
    pads: Number(r.pads),
  };
}

/** `$platinum_name;` -> `Platinum`. Only used when Frontier omits the localised name. */
function symbolToName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const stripped = raw.replace(/^\$/, '').replace(/_name;?$/i, '').replace(/[_-]+/g, ' ').trim();
  if (stripped === '') return null;
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
