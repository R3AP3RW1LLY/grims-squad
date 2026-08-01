import type { PrismaClient } from '@grims/db';

/**
 * Resolving an EDDN `marketId` to a station we hold.
 *
 * ★ WHY THIS NEEDS A CACHE AT ALL ★
 *
 * Every commodity message carries a `marketId` and nothing else that identifies the station — no
 * key, no system id, and not even a station type. Placing it means a query against
 * `knowledge_items`, and EDDN delivers roughly one commodity message a second, sustained, for ever.
 *
 * ★ MISSES ARE CACHED TOO, AND THAT IS THE POINT ★
 *
 * Most stations EDDN reports are ones we do not hold: a fleet carrier that jumped since the last
 * dump, a construction site laid down this morning, a system Spansh has not indexed. Without a
 * negative cache each of those costs a query EVERY time it reports — and the stations reporting
 * most often are exactly the busy ones.
 *
 * ★ BUT A MISS MUST EXPIRE ★
 *
 * The galaxy ingest runs nightly and introduces new stations. A permanent negative entry would mean
 * a station imported at 03:00 stays invisible to the collector until somebody restarts it — the
 * silent, self-inflicted staleness this whole service exists to remove. Misses are therefore held
 * for an hour and then retried.
 *
 * Hits do not expire on a timer: `ext_key`, name and system do not change for a station that
 * exists, and the entry is dropped when the cache is trimmed like any other.
 */

export interface Station {
  readonly key: string;
  readonly name: string;
  readonly system: string;
  readonly type: string | null;
  readonly pads: number;
}

/** How long to remember that we do NOT hold a station, before asking again. */
export const MISS_TTL_MS = 60 * 60 * 1000;

/**
 * How many market ids to remember.
 *
 * The bubble has ~275,000 stations and only a fraction report in any hour, so this holds the
 * working set comfortably while bounding a process that is meant to run for months.
 */
export const CACHE_MAX = 50_000;

interface Entry {
  readonly station: Station | null;
  readonly at: number;
}

export class StationCache {
  readonly #entries = new Map<number, Entry>();
  #hits = 0;
  #misses = 0;
  #queries = 0;

  get size(): number {
    return this.#entries.size;
  }

  /** Cache hit rate since the last `takeStats`, for the window report. */
  takeStats(): { hits: number; misses: number; queries: number } {
    const out = { hits: this.#hits, misses: this.#misses, queries: this.#queries };
    this.#hits = 0;
    this.#misses = 0;
    this.#queries = 0;
    return out;
  }

  async lookup(db: PrismaClient, marketId: number, now = Date.now()): Promise<Station | null> {
    const cached = this.#entries.get(marketId);
    if (cached !== undefined) {
      // A hit never goes stale; a miss does. See the note above about the nightly ingest.
      if (cached.station !== null || now - cached.at < MISS_TTL_MS) {
        this.#hits += 1;
        return cached.station;
      }
    }

    this.#misses += 1;
    this.#queries += 1;

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
    const station: Station | null =
      r === undefined
        ? null
        : { key: r.ext_key, name: r.name, system: r.system ?? '', type: r.type, pads: Number(r.pads) };

    this.#remember(marketId, station, now);
    return station;
  }

  #remember(marketId: number, station: Station | null, at: number): void {
    /*
     * Oldest-inserted first, which a Map gives for free by iteration order. Not a true LRU — a real
     * one needs a reordering touch on every hit, and at this hit rate the cost of that outweighs
     * what it saves. Evicting the oldest inserted is a station that has not reported since it was
     * added, which is close enough to what we want.
     */
    if (this.#entries.size >= CACHE_MAX) {
      const oldest = this.#entries.keys().next();
      if (oldest.done !== true) this.#entries.delete(oldest.value);
    }
    this.#entries.set(marketId, { station, at });
  }
}
