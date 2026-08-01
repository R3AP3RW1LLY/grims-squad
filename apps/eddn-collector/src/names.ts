import type { PrismaClient } from '@grims/db';

/**
 * Turning EDDN's internal commodity symbols into the names our tables are keyed on.
 *
 * ★ THE MISMATCH, AND WHY IT WOULD HAVE BEEN SILENT ★
 *
 * EDDN reports commodities by Frontier's internal symbol, lower case and unpunctuated:
 *
 *     advancedcatalysers, lowtemperaturediamond, ceramiccomposites
 *
 * `market_entries.commodity` holds the DISPLAY name, because that is what the Spansh dump carries
 * and what a member types into a search box:
 *
 *     Advanced Catalysers, Low Temperature Diamonds, Ceramic Composites
 *
 * Writing the symbol straight through would not fail. It would insert a second row for every
 * commodity at every station — "advancedcatalysers" beside "Advanced Catalysers" — and route
 * queries, which filter on the display name, would never see the fresh one. The table would grow,
 * the collector would report thousands of updates an hour, and every price shown would still be
 * from last night's dump.
 *
 * ★ THE SQUASH KEY, AND WHY IT IS ONLY THREE QUARTERS OF THE ANSWER ★
 *
 * Lower-case, strip everything that is not a letter or digit, on both sides:
 *
 *     'Advanced Catalysers' -> 'advancedcatalysers'  ==  'advancedcatalysers'
 *
 * That was the whole design, and against sixty seconds of the live relay it resolved 7,013 of 9,051
 * commodity lines. The other 2,038 — TWENTY-TWO PER CENT — did not, because a great many of
 * Frontier's internal symbols are not the display name with the spaces taken out:
 *
 *     lowtemperaturediamond    -> Low Temperature Diamonds     (singular symbol, plural name)
 *     opal                     -> Void Opal
 *     agriculturalmedicines    -> Agri-Medicines
 *     marinesupplies           -> Marine Equipment
 *     atmosphericextractors    -> Atmospheric Processors
 *     usscargoblackbox         -> Black Box
 *     unocuppiedescapepod      -> Unoccupied Escape Pod         (Frontier's own typo, in the symbol)
 *
 * No rule derives those. They have to be looked up.
 *
 * ★ EDCD PUBLISHES THE TABLE, SO WE READ IT RATHER THAN INVENT IT ★
 *
 * `EDCD/FDevIDs` is the community's maintained id list and the same project Coriolis comes from —
 * we already self-update from it elsewhere. Two files: `commodity.csv` for the standard market and
 * `rare_commodity.csv` for the rares. Together 398 entries, of which 396 map onto a name we hold;
 * the two that do not (`Drones` -> Limpets, `PoliticalPrisoner`) are commodities absent from our
 * table entirely, so there is nothing for them to map to.
 *
 * ★ OUR OWN DATA IS STILL THE AUTHORITY ★
 *
 * The CSV supplies the ALIAS — which symbol means which commodity. What that commodity is CALLED in
 * our tables comes from our tables, because `market_entries.commodity` is what every route query
 * filters on. Writing EDCD's spelling instead would create a second row for the same commodity
 * whenever the two disagreed, which is precisely the failure this whole file exists to prevent.
 *
 * So the chain is: EDDN symbol -> EDCD name -> our name. Each hop squashed, and the last hop
 * tolerant of a trailing "s" because singular-versus-plural is the single most common difference
 * between the two spellings.
 */

/** `Low Temperature Diamonds` and `lowtemperaturediamonds` both become the same key. */
export function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Where the alias table comes from. Two files, one project. */
export const EDCD_COMMODITY_CSV =
  'https://raw.githubusercontent.com/EDCD/FDevIDs/master/commodity.csv';
export const EDCD_RARE_CSV =
  'https://raw.githubusercontent.com/EDCD/FDevIDs/master/rare_commodity.csv';

/**
 * Parses `symbol` and `name` out of an EDCD csv.
 *
 * Columns are read BY HEADER rather than by position: the two files do not agree on layout
 * (`rare_commodity.csv` carries an extra `market_id` column), and a positional reader would take
 * the market id for a category and be wrong without failing.
 */
export function parseEdcdCsv(text: string): Array<{ symbol: string; name: string }> {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.split(',').map((h) => h.trim()) ?? [];
  const si = header.indexOf('symbol');
  const ni = header.indexOf('name');
  if (si === -1 || ni === -1) return [];

  const out: Array<{ symbol: string; name: string }> = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const cells = line.split(',');
    const symbol = cells[si]?.trim() ?? '';
    const name = cells[ni]?.trim() ?? '';
    if (symbol !== '' && name !== '') out.push({ symbol, name });
  }
  return out;
}

/**
 * How often the map is rebuilt.
 *
 * The set of commodities changes when Frontier ships an update — roughly twice a year. Hourly is
 * far more often than needed and costs one indexed aggregate, which matters more than being clever:
 * a collector that has to be restarted to learn a new commodity is a collector somebody has to
 * remember to restart.
 */
export const NAMES_REFRESH_MS = 60 * 60 * 1000;

/** What we know about a commodity, beyond the numbers EDDN sends. */
export interface Commodity {
  readonly name: string;
  /**
   * ★ CARRIED BECAUSE EDDN DOES NOT SEND IT ★
   *
   * `commodity/3` has no category field. Writing NULL would mean every station EDDN refreshed
   * quietly lost the category the galaxy dump had filled in — the rows would still be there, still
   * priced, and a grouped view would start showing "Uncategorised" for the busiest stations in the
   * bubble while the quiet ones stayed correct.
   *
   * A commodity's category is a global fact — Platinum is Metals everywhere — so it can be carried
   * on the same map as the name, from the same rows, at no extra cost.
   */
  readonly category: string | null;
}

export class CommodityNames {
  #bySquash = new Map<string, Commodity>();
  /** EDDN symbol (squashed) -> the commodity it means. Built from the EDCD files. */
  #aliases = new Map<string, Commodity>();
  #loadedAt = 0;
  /** Symbols seen that we could not place, so the count can be reported rather than lost. */
  readonly unknown = new Set<string>();

  get size(): number {
    return this.#bySquash.size;
  }

  async refresh(db: PrismaClient, now = Date.now()): Promise<number> {
    /*
     * `DISTINCT ON` rather than `DISTINCT`: the same commodity can carry a null category at one
     * station and a real one at another, and ordering nulls last picks the informative row.
     *
     * ★ BOUNDED, BECAUSE THIS SCANS EIGHTEEN MILLION ROWS ★
     *
     * It takes about ten seconds on a healthy table, which is affordable once an hour. It takes
     * FOREVER while the nightly rebuild holds ACCESS EXCLUSIVE — and since the collector retries
     * its whole connect sequence, each attempt left another copy of this query queued behind the
     * rebuild. Four of them were observed stacked up at once, the oldest 910 seconds old.
     *
     * With a timeout the attempt fails, the caller keeps whatever map it already had, and the next
     * hourly refresh picks up the change. A commodity list that is an hour stale is not a problem;
     * four queued full scans are.
     */
    let rows: Array<{ commodity: string; category: string | null }>;
    try {
      rows = await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '60s'`);
          return tx.$queryRawUnsafe<Array<{ commodity: string; category: string | null }>>(
            `SELECT DISTINCT ON (commodity) commodity, category
               FROM market_entries
              ORDER BY commodity, category NULLS LAST`,
          );
        },
        { timeout: 90_000 },
      );
    } catch {
      /*
       * Swallowed rather than thrown, because throwing here reaches the reconnect loop and the
       * reconnect loop retries every fifteen seconds — which against a thirty-minute rebuild is a
       * hundred and twenty more full scans queued behind it. The failure this was written to stop.
       *
       * The map we already hold is still correct; the table is being repopulated with the same
       * commodities. `this.#loadedAt` is NOT advanced, so the next call tries again rather than
       * waiting out the full hour.
       */
      return this.#bySquash.size;
    }

    const next = new Map<string, Commodity>();
    for (const r of rows) next.set(squash(r.commodity), { name: r.commodity, category: r.category });

    /*
     * Only replaced if the query returned something. An empty result means the galaxy ingest is
     * mid-rebuild (it truncates before it reloads), and adopting that would make every message
     * unknown for the length of the import — discarding an hour of live prices for a table that is
     * about to be full again.
     */
    if (next.size > 0) {
      this.#bySquash = next;
      this.unknown.clear();
      await this.#loadAliases();
    }
    this.#loadedAt = now;
    return this.#bySquash.size;
  }

  /** How many EDDN symbols the alias table can place. Reported on the live log at startup. */
  get aliasCount(): number {
    return this.#aliases.size;
  }

  /**
   * Fetches the EDCD tables and maps each symbol onto a name WE hold.
   *
   * ★ FAILURE IS NOT FATAL, BY DESIGN ★
   *
   * GitHub being unreachable must not stop the collector: without the aliases it still resolves
   * roughly three quarters of the feed, which is a great deal better than no prices at all. The
   * previous table is kept if there was one, and the count is reported so a permanently empty alias
   * map is visible rather than merely quiet.
   */
  async #loadAliases(): Promise<void> {
    const next = new Map<string, Commodity>();

    for (const url of [EDCD_COMMODITY_CSV, EDCD_RARE_CSV]) {
      let text: string;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        text = await res.text();
      } catch {
        continue; // Offline, rate limited, or the file moved. Handled by keeping what we have.
      }

      for (const { symbol, name } of parseEdcdCsv(text)) {
        const key = squash(symbol);
        // Already resolvable directly? Then the alias would be a no-op, and skipping it keeps the
        // table down to the entries that actually earn their place.
        if (this.#find(key) !== undefined) continue;

        const ours = this.#find(squash(name));
        if (ours !== undefined) next.set(key, ours);
      }
    }

    if (next.size > 0) this.#aliases = next;
  }

  /**
   * Our commodity for a squashed key, tolerating a trailing "s" in either direction.
   *
   * Singular-versus-plural is the commonest disagreement between Frontier's spelling and Spansh's —
   * `Opal` against "Void Opals", `LowTemperatureDiamond` against "Low Temperature Diamonds". A
   * collision would need two commodities differing only by a final letter, which this list does not
   * contain.
   */
  #find(key: string): Commodity | undefined {
    return (
      this.#bySquash.get(key) ??
      this.#bySquash.get(`${key}s`) ??
      (key.endsWith('s') ? this.#bySquash.get(key.slice(0, -1)) : undefined)
    );
  }

  async refreshIfStale(db: PrismaClient, now = Date.now()): Promise<void> {
    if (now - this.#loadedAt >= NAMES_REFRESH_MS) await this.refresh(db, now);
  }

  /**
   * The display name for an EDDN symbol, or null if we hold no commodity that matches.
   *
   * ★ NULL RATHER THAN A GUESS ★
   *
   * Title-casing the symbol would produce "Lowtemperaturediamond", which is not a name anybody
   * searches for and not a name that joins to anything. It would look like the collector was
   * working while quietly building a parallel set of rows no query returns.
   *
   * Unknown symbols are counted and reported on the live log instead. In practice they appear only
   * when Frontier adds a commodity, and the nightly galaxy ingest introduces it within a day.
   */
  resolve(symbol: string): Commodity | null {
    const key = squash(symbol);
    // Ours first: it is the authority on what a commodity is called. The alias table only answers
    // the question our own names cannot — which symbol means which commodity.
    const hit = this.#find(key) ?? this.#aliases.get(key);
    if (hit !== undefined) return hit;
    this.unknown.add(symbol);
    return null;
  }
}
