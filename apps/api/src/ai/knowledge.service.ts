import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { PLACE_KINDS } from '@grims/shared';

/*
 * The place kinds as a SQL literal list, built from the constant so the two cannot drift.
 *
 * Interpolated into the query rather than bound as a parameter, which is safe here because every
 * value comes from a compile-time `as const` in @grims/shared and nothing user-supplied reaches it.
 * A bound parameter is the natural instinct and it silently breaks the partial-index match — see
 * the note at the query.
 */
const PLACE_LIST = PLACE_KINDS.map((k) => `'${k}'`).join(', ');
import { EmbedClient } from './embed.client.js';

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

/**
 * How close a vector has to be before it counts as an answer.
 *
 * ★ A FLOOR, BECAUSE NEAREST IS NOT THE SAME AS RELEVANT ★
 *
 * A nearest-neighbour search always returns something. Ask "what is the capital of France" against
 * a corpus of Elite Dangerous guides and it will hand back the eight least-unrelated paragraphs it
 * has, with no signal that every one of them is nonsense — and the model, handed eight paragraphs
 * and a question, will find a way to connect them.
 *
 * Cosine similarity of 0.55 was picked by trying it: real questions about mechanics we have written
 * about land between 0.6 and 0.8, and questions about things we have never covered sit under 0.5.
 * Below the floor the honest answer is that we do not know, which is the whole point of separating
 * facts from language.
 */
const MIN_SIMILARITY = 0.55;

/**
 * How alike two NAMES have to be to count as the same thing.
 *
 * Separate from the vector floor because it measures something else entirely — shared trigrams, not
 * shared meaning — and because the failure it prevents is different. See `byName`.
 */
const MIN_NAME_SIMILARITY = 0.55;

/**
 * How old a price may be and still be offered as the best one.
 *
 * Thirty days. Long enough that a whole region does not fall out of the answer between visits,
 * short enough to exclude the years-old carrier prices that otherwise top every ranking. See the
 * measurements in `market`.
 */
const MAX_PRICE_AGE_DAYS = 30;

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    /**
     * Optional, so every consumer of name/spatial/market retrieval does not acquire a dependency on
     * a running embedding model. Semantic search returns nothing when it is absent, which is the
     * correct degradation: the other three legs still work.
     */
    @Inject(EmbedClient) private readonly embed: EmbedClient | null = null,
  ) {}

  /**
   * Facts by MEANING — the leg this service documented and did not have.
   *
   * ★ WHAT THE OTHER THREE CANNOT DO ★
   *
   * "How do I get more jump range" names no ship, no system and no commodity. There is nothing to
   * look it up BY. The answer is a paragraph in a guide that very likely never uses the word
   * "jump range" in those words, and only a vector can find it.
   *
   * ★ THIS COMMENT USED TO SAY THE FILTER WAS UNNECESSARY — 2026-08-22 ★
   *
   * It said: "restricted to embedded sources by construction ... only prose sources are ever
   * embedded (see STORAGE_KIND). A market row has no vector and cannot surface here." That was true
   * when written, and it stopped being true the day the squadron owner asked for full EDDN coverage
   * and 687,000 systems and stations gained vectors.
   *
   * Nothing failed loudly. "How do I become a member of the squadron" simply started returning five
   * star system names, because 302 prose rows cannot win an APPROXIMATE search against 687,000
   * places — the joining guide sat at cosine distance 0.2183 while the index returned rows at
   * 0.3904, and an exact scan found the guide instantly every time.
   *
   * So the restriction is now IN THE QUERY rather than in this comment. Adding data cannot break
   * it again.
   */
  async semantic(query: string, limit = LIMIT): Promise<Fact[]> {
    if (this.embed === null || !this.embed.configured) return [];

    const vector = await this.embed.embed(query);
    if (vector === null) return [];

    const rows = await this.db.$queryRawUnsafe<
      Array<{
        source: string;
        kind: string;
        name: string;
        text: string | null;
        data: unknown;
        similarity: number;
      }>
    >(
      /*
       * Ordered by the operator so the HNSW index can serve it. Filtering on similarity in the
       * WHERE clause instead would force a sequential scan over every embedded row — and there are
       * hundreds of thousands of them.
       *
       * The floor is applied AFTER the index has done its work, in the outer query.
       */
      `SELECT source, kind, name, text, data, similarity
         FROM (
           SELECT source, kind, name, text, data,
                  1 - (embedding <=> $1::vector) AS similarity
             FROM knowledge_items
            WHERE embedding IS NOT NULL
              /*
               * ★ A LITERAL LIST, AND IT HAS TO BE — MEASURED 2026-08-22 ★
               *
               * This must match the knowledge_items_embedding_prose_idx predicate EXACTLY, or
               * Postgres cannot prove the query is covered by that partial index and falls back to
               * the shared one. Written first as an inequality against a BOUND PARAMETER — the
               * same condition, expressed the way one normally would — and that does not match:
               * the planner used the place-dominated index, fetched its candidates, filtered every
               * one of them away, and returned ZERO ROWS in 11ms.
               *
               * That is worse than the bug it was fixing. An assistant that answers nothing looks
               * like an assistant with nothing to say, and nobody reports that.
               *
               * Built from PLACE_KINDS rather than typed out, so the code and the index cannot
               * drift; prose-not-places.spec.ts holds the migration to the same list.
               *
               * (No backticks anywhere in this comment: it lives INSIDE a template literal, and a
               * stray one ends the string. That trap has now cost this project five separate
               * occasions, every one of them an unterminated-string error pointing somewhere else.)
               */
              AND kind NOT IN (${PLACE_LIST})
            ORDER BY embedding <=> $1::vector
            LIMIT $2
         ) ranked
        WHERE similarity >= $3
        ORDER BY similarity DESC`,
      `[${vector.join(',')}]`,
      limit,
      MIN_SIMILARITY,
    );

    return rows.map(toFact);
  }

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
      /*
       * ★ AND A FLOOR ON TOP OF THE OPERATOR ★
       *
       * pg_trgm's default threshold is 0.3, which is loose enough to be actively harmful here.
       * Asked "where can I sell Painite", the router looked up the capitalised word by name and
       * got back the stations "Paine Mine", "Pacalite" and "Pate" — three rows of pure noise
       * handed to the model as facts, in an answer about prices.
       *
       * 0.55 keeps the misspellings this exists for ("krait mk2", "platinium") while dropping
       * words that merely share letters. The operator still does the index work; this only decides
       * what survives it.
       */
      `SELECT source, kind, name, text, data
         FROM knowledge_items
        WHERE name % $1 AND similarity(name, $1) >= $3
        -- similarity() rather than the % operator's own ordering: the operator filters, this ranks,
        -- and without an explicit ORDER BY the "best" match is whichever row Postgres reached first.
        ORDER BY similarity(name, $1) DESC
        LIMIT $2`,
      query,
      limit,
      MIN_NAME_SIMILARITY,
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
    opts: {
      near?: { x: number; y: number; z: number };
      radiusLy?: number;
      largePadOnly?: boolean;
      /** Set only by the fallback below, when a fresh search found nothing at all. */
      anyAge?: boolean;
    } = {},
  ): Promise<Fact[]> {
    const radius = opts.radiusLy ?? DEFAULT_RADIUS_LY;
    const params: unknown[] = [commodity];
    const where: string[] = [
      // Trigram, so "platinium" still finds Platinum. See byName.
      `commodity % $1`,
      side === 'buy' ? `supply > 0 AND buy_price > 0` : `demand > 0 AND sell_price > 0`,
    ];

    /*
     * ★ FRESH PRICES ONLY, AND THE NUMBERS SAY WHY — 2026-08-01 ★
     *
     * Ordering by price alone puts the highest number first regardless of when anybody last saw it,
     * and the highest numbers are the oldest. Measured against the real table, for Painite:
     *
     *     seen under 7 days   13,481 rows   best 436,124 CR
     *     seen 7-30 days      23,014 rows   best 280,625 CR
     *     seen 30 days-1 year 81,549 rows   best 320,262 CR
     *     seen over 1 year     9,182 rows   best 715,960 CR   <- what the assistant recommended
     *
     * That 715,960 is a fleet carrier price from before the last balance pass, at a carrier that
     * jumped away years ago. The assistant offered it as the best place to sell — correctly noting
     * it was 2,077 days old, which no member reading a confident list of stations would weigh
     * against the number beside it.
     *
     * A stale price is not a slightly worse answer than a fresh one. It is a wasted trip, which is
     * the specific harm this whole knowledge layer exists to avoid.
     */
    if (opts.anyAge !== true) {
      const i0 = params.length;
      params.push(MAX_PRICE_AGE_DAYS);
      where.push(
        `market_seen_at IS NOT NULL AND market_seen_at > now() - ($${i0 + 1} || ' days')::interval`,
      );
    }

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

    /*
     * ★ AND A FALLBACK, SO A QUIET COMMODITY STILL GETS AN ANSWER ★
     *
     * The window is right for anything actively traded. For something nobody has reported in months
     * it would return nothing at all, and "I have no prices for that" is a worse answer than an old
     * price clearly labelled as old — which `seenNote` does on every row.
     *
     * Only when the fresh search came back empty, so a stale row can never outrank a current one.
     */
    if (rows.length === 0 && opts.anyAge !== true) {
      return this.market(commodity, side, { ...opts, anyAge: true });
    }

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
