import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';

/**
 * Finding the facts that answer a question.
 *
 * ★ THIS IS THE HALF THAT DECIDES WHETHER THE ASSISTANT IS ANY GOOD ★
 *
 * The model supplies language and reasoning; this supplies the facts. Where those two are
 * separated the assistant can say "I do not know" instead of inventing — which is the single most
 * important property a squadron tool can have, because a confidently wrong answer about where to
 * sell Painite costs somebody an hour of flying.
 *
 * ★ FOUR DIFFERENT SEARCHES, BECAUSE THERE ARE FOUR DIFFERENT QUESTIONS ★
 *
 * A single "search the knowledge base" function would have to be a compromise between shapes that
 * have nothing in common:
 *
 *   "what does a Krait hold"          exact lookup by name          -> trigram over name
 *   "stations within 30ly of Deciat"  spatial                       -> cube index over coords
 *   "where can I sell Platinum"       ranked scan of one commodity  -> market_entries partial index
 *   "how do I engineer FSD range"     meaning                       -> prose, and the only vectors
 *
 * Each is a different index. Collapsing them would mean three of the four use the wrong one, and
 * the symptom of a wrong index here is not an error — it is a query that takes forty seconds and
 * returns something plausible.
 */

/** One fact, ready to hand to the model. */
export interface Fact {
  readonly source: string;
  readonly kind: string;
  readonly name: string;
  /** What the model reads. Prose where we have it, a rendered summary where we do not. */
  readonly text: string;
  /** Where it came from, so an answer can be traced. Null where there is nowhere to point. */
  readonly url: string | null;
}

/** How many facts one answer is built from. */
const LIMIT = 8;

/**
 * How far a spatial question reaches by default.
 *
 * Fifty light years. Far enough that a real trading question has candidates, near enough that the
 * cube index is doing work rather than returning a tenth of the bubble.
 */
const DEFAULT_RADIUS_LY = 50;

@Injectable()
export class KnowledgeService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  /**
   * Facts for a question, by name.
   *
   * ★ TRIGRAM, NOT EQUALITY ★
   *
   * Members type "krait mk2", "Krait MkII" and "krait mark 2" for the same ship, and Frontier
   * writes a fourth thing. An exact match answers none of those, and answering none of them looks
   * exactly like not having the data.
   */
  async byName(query: string, limit = LIMIT): Promise<Fact[]> {
    const rows = await this.db.$queryRawUnsafe<
      Array<{ source: string; kind: string; name: string; text: string | null; data: unknown }>
    >(
      `SELECT source, kind, name, text, data
         FROM knowledge_items
        WHERE name % $1
        -- similarity() rather than the % operator's own ordering: the operator filters, this ranks,
        -- and without an explicit ORDER BY the "best" match is whichever row Postgres reached first.
        ORDER BY similarity(name, $1) DESC
        LIMIT $2`,
      query,
      limit,
    );

    return rows.map(toFact);
  }

  /**
   * Stations and systems near a named system.
   *
   * ★ TWO STEPS, AND THE FIRST ONE IS THE POINT ★
   *
   * "Within 30ly of Deciat" needs Deciat's coordinates before it can mean anything. Resolving the
   * origin first — and returning nothing when it cannot be resolved — is what stops the assistant
   * answering a spatial question about a system it could not find, which it would otherwise do by
   * silently searching from the origin of the galaxy.
   */
  async near(systemName: string, radiusLy = DEFAULT_RADIUS_LY, limit = LIMIT): Promise<Fact[]> {
    const origin = await this.db.$queryRawUnsafe<Array<{ x: number; y: number; z: number }>>(
      /*
       * ★ cube's -> IS ONE-BASED ★
       *
       * `coords->1` is x, not y. Written 0-based first, and verified against the real column
       * before it shipped: `(82.125, -41.65625, -151.5)` reads back correctly only from 1.
       * Zero-based would have silently shifted every axis by one and returned plausible systems
       * from the wrong part of the galaxy — a spatial answer that is wrong is indistinguishable
       * from one that is right without checking it against the game.
       */
      `SELECT (coords->1)::float8 AS x, (coords->2)::float8 AS y, (coords->3)::float8 AS z
         FROM knowledge_items
        WHERE source='galaxy' AND kind='system' AND name = $1 AND coords IS NOT NULL
        LIMIT 1`,
      systemName,
    );

    const o = origin[0];
    if (o === undefined) return [];

    const rows = await this.db.$queryRawUnsafe<
      Array<{ source: string; kind: string; name: string; text: string | null; data: unknown; ly: number }>
    >(
      `SELECT source, kind, name, text, data,
              -- The real distance, for the answer. The index below only bounds the search.
              sqrt(power((coords->1)::float8 - $1, 2)
                 + power((coords->2)::float8 - $2, 2)
                 + power((coords->3)::float8 - $3, 2)) AS ly
         FROM knowledge_items
        WHERE source='galaxy' AND coords IS NOT NULL
          /*
           * The cube containment operator, which is what the GiST index can answer. It bounds a
           * BOX rather than a sphere, so it over-selects the corners — the ORDER BY and LIMIT below
           * discard them. Filtering on the true distance alone would be correct and would scan
           * every one of 448,000 rows.
           */
          AND coords <@ cube(array[$1::float8 - $4, $2::float8 - $4, $3::float8 - $4],
                             array[$1::float8 + $4, $2::float8 + $4, $3::float8 + $4])
        ORDER BY ly
        LIMIT $5`,
      o.x,
      o.y,
      o.z,
      radiusLy,
      limit,
    );

    return rows.map((r) => ({
      ...toFact(r),
      text: `${toFact(r).text} (${r.ly.toFixed(1)} ly from ${systemName}.)`,
    }));
  }

  /**
   * Where to buy or sell a commodity.
   *
   * ★ READS market_entries, NOT knowledge_items ★
   *
   * The same question against the nested JSON was a lateral over 275,000 stations that exhausted
   * the disk and took Postgres down with it. Here it is an index scan over one commodity.
   */
  async market(
    commodity: string,
    side: 'buy' | 'sell',
    opts: { near?: { x: number; y: number; z: number }; radiusLy?: number; largePadOnly?: boolean } = {},
  ): Promise<Fact[]> {
    const radius = opts.radiusLy ?? DEFAULT_RADIUS_LY;
    const params: unknown[] = [commodity];
    const where: string[] = [
      // Trigram, so "platinium" still finds Platinum. See byName.
      `commodity % $1`,
      side === 'buy' ? `supply > 0 AND buy_price > 0` : `demand > 0 AND sell_price > 0`,
    ];

    if (opts.largePadOnly === true) where.push(`large_pads > 0`);

    if (opts.near !== undefined) {
      const i = params.length;
      params.push(opts.near.x, opts.near.y, opts.near.z, radius);
      where.push(
        `coords IS NOT NULL AND coords <@ cube(` +
          `array[$${i + 1}::float8 - $${i + 4}, $${i + 2}::float8 - $${i + 4}, $${i + 3}::float8 - $${i + 4}],` +
          `array[$${i + 1}::float8 + $${i + 4}, $${i + 2}::float8 + $${i + 4}, $${i + 3}::float8 + $${i + 4}])`,
      );
    }

    params.push(LIMIT);

    const rows = await this.db.$queryRawUnsafe<
      Array<{
        station_name: string;
        system_name: string;
        station_type: string | null;
        commodity: string;
        buy_price: number;
        sell_price: number;
        supply: number;
        demand: number;
        large_pads: number;
        market_seen_at: Date | null;
      }>
    >(
      `SELECT station_name, system_name, station_type, commodity,
              buy_price, sell_price, supply, demand, large_pads, market_seen_at
         FROM market_entries
        WHERE ${where.join(' AND ')}
        -- Cheapest to buy, dearest to sell. The partial indexes are built in exactly these orders.
        ORDER BY ${side === 'buy' ? 'buy_price ASC' : 'sell_price DESC'}
        LIMIT $${params.length}`,
      ...params,
    );

    return rows.map((r) => ({
      source: 'galaxy',
      kind: `market-${side}`,
      name: `${r.station_name} (${r.system_name})`,
      text:
        side === 'buy'
          ? `${r.commodity} at ${r.station_name} in ${r.system_name} — ${r.buy_price.toLocaleString()} CR each, ` +
            `${r.supply.toLocaleString()} tonnes in stock. ${padNote(r)}${seenNote(r.market_seen_at)}`
          : `${r.commodity} at ${r.station_name} in ${r.system_name} — ${r.sell_price.toLocaleString()} CR each, ` +
            `demand ${r.demand.toLocaleString()}. ${padNote(r)}${seenNote(r.market_seen_at)}`,
      url: null,
    }));
  }
}

/** Whether a Panther Clipper can actually land there. */
function padNote(r: { large_pads: number; station_type: string | null }): string {
  const type = r.station_type === null ? '' : `${r.station_type}, `;
  return `${type}${r.large_pads > 0 ? 'large pad' : 'no large pad'}.`;
}

/**
 * How old the price is.
 *
 * ★ NEVER OMITTED ★
 *
 * A price with no date is a claim about NOW, and it might be from last week. The whole difference
 * between a useful trading answer and a wasted trip is whether somebody knew to check.
 */
function seenNote(at: Date | null): string {
  if (at === null) return ' Age unknown.';
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return ' Seen today.';
  if (days === 1) return ' Seen yesterday.';
  return ` Seen ${days} days ago.`;
}

function toFact(r: {
  source: string;
  kind: string;
  name: string;
  text: string | null;
  data: unknown;
}): Fact {
  const data = (r.data ?? {}) as Record<string, unknown>;

  return {
    source: r.source,
    kind: r.kind,
    name: r.name,
    /*
     * The prose if we wrote any, otherwise a rendered summary of the row.
     *
     * Handing raw JSON to the model makes it paraphrase a data structure; it will also happily
     * invent a field name that was not there. A sentence gives it something to quote.
     */
    text: r.text ?? summarise(r.name, r.kind, data),
    url: typeof data['url'] === 'string' ? data['url'] : null,
  };
}

/** A structured row as a sentence, for the sources that store no prose. */
function summarise(name: string, kind: string, data: Record<string, unknown>): string {
  const bits: string[] = [`${name} (${kind})`];

  for (const [key, value] of Object.entries(data)) {
    // Nested objects and arrays are skipped: a module list flattened into a sentence is noise, and
    // the fields worth naming are the scalar ones a member would actually ask about.
    if (value === null || typeof value === 'object') continue;
    bits.push(`${key}: ${String(value)}`);
  }

  return bits.join('. ');
}
