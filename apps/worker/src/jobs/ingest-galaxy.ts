import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

/**
 * Systems and stations, from the Spansh galaxy dump.
 *
 * ★ STREAMED, NOT PARSED ★
 *
 * The populated dump is 3.97GB compressed and several times that expanded. `JSON.parse` on the whole
 * thing needs the entire structure resident and would exhaust the heap long before it finished.
 *
 * Spansh writes one system per LINE inside the array, which makes a line-oriented read possible: one
 * system in memory at a time, constant footprint, regardless of whether the file is four gigabytes
 * or forty. The trailing comma and the array brackets are the only things that need handling.
 *
 * That format is not contractual — it is how the file happens to be written. `parseSystemLine`
 * returns null for anything that is not a system object, so a reformat upstream degrades this to
 * "found nothing" rather than crashing mid-import.
 */

export interface SystemRow {
  readonly source: 'galaxy';
  readonly kind: 'system' | 'station';
  readonly extKey: string;
  readonly name: string;
  readonly data: Record<string, unknown>;
  /** Galactic position, for the `cube` index. Stations inherit their system's. */
  readonly coords: { x: number; y: number; z: number } | null;
}

interface RawSystem {
  id64?: unknown;
  name?: unknown;
  coords?: { x?: unknown; y?: unknown; z?: unknown };
  allegiance?: unknown;
  government?: unknown;
  primaryEconomy?: unknown;
  security?: unknown;
  population?: unknown;
  bodyCount?: unknown;
  controllingFaction?: { name?: unknown };
  stations?: unknown;
}

/**
 * Turns one line of the dump into rows, or null.
 *
 * Exported so the shape can be tested without a 4GB file — the parsing is the part that breaks when
 * Spansh changes their export, and it should not need an overnight run to find out.
 */
export function parseSystemLine(line: string): SystemRow[] | null {
  // Array brackets and the trailing comma on every element.
  const trimmed = line.trim().replace(/,$/, '');
  if (trimmed === '' || trimmed === '[' || trimmed === ']') return null;

  let raw: RawSystem;
  try {
    raw = JSON.parse(trimmed) as RawSystem;
  } catch {
    return null;
  }

  const name = typeof raw.name === 'string' ? raw.name : null;
  const id64 = typeof raw.id64 === 'number' ? raw.id64 : null;
  if (name === null || id64 === null) return null;

  const coords =
    typeof raw.coords?.x === 'number' &&
    typeof raw.coords?.y === 'number' &&
    typeof raw.coords?.z === 'number'
      ? { x: raw.coords.x, y: raw.coords.y, z: raw.coords.z }
      : null;

  const rows: SystemRow[] = [
    {
      source: 'galaxy',
      kind: 'system',
      /*
       * id64 rather than the name. Names are not unique in Elite — procedurally generated sectors
       * repeat them — and a name key would silently merge two different places into one row.
       */
      extKey: String(id64),
      name,
      data: {
        allegiance: raw.allegiance ?? null,
        government: raw.government ?? null,
        economy: raw.primaryEconomy ?? null,
        security: raw.security ?? null,
        population: raw.population ?? null,
        bodyCount: raw.bodyCount ?? null,
        controllingFaction: raw.controllingFaction?.name ?? null,
      },
      coords,
    },
  ];

  /*
   * Stations are stored as their OWN rows rather than nested in the system.
   *
   * "Which stations have a large pad" and "where can I buy a Krait" are queries against stations,
   * and a station buried inside a system's JSON can only be found by scanning every system. As rows
   * they are indexed, filterable, and countable.
   *
   * They carry the system's coordinates so a spatial search finds them directly — a station's
   * position IS its system's for every question anybody asks.
   */
  for (const station of Array.isArray(raw.stations) ? raw.stations : []) {
    const s = station as {
      id?: unknown; name?: unknown; type?: unknown; landingPads?: unknown; services?: unknown;
      market?: { commodities?: unknown; updateTime?: unknown };
      economies?: unknown; primaryEconomy?: unknown; government?: unknown;
      controllingFaction?: unknown; distanceToArrival?: unknown; updateTime?: unknown;
    };
    const sName = typeof s.name === 'string' ? s.name : null;
    if (sName === null) continue;

    rows.push({
      source: 'galaxy',
      kind: 'station',
      // Namespaced by system: station names repeat across the galaxy constantly.
      extKey: `${id64}/${sName}`,
      name: sName,
      /*
       * ★ THE MARKET IS KEPT, AND IT WAS NOT AT FIRST ★
       *
       * The first pass stored only type, pads and services — and threw away the commodity list that
       * was sitting in the same object. "Where can I sell Painite" and "what does this station buy"
       * are among the most common questions anybody asks about Elite, and answering them needed no
       * new download at all: the data had already been fetched and discarded.
       *
       * It is the bulk of the row. That is the cost of being able to answer the question.
       */
      data: {
        system: name,
        systemId64: id64,
        /*
         * ★ THE MARKET ID, AND WITHOUT IT LIVE UPDATES ARE IMPOSSIBLE ★
         *
         * A journal event carries `MarketID` and nothing else that identifies where it happened — no
         * station name, no system. Without this stored alongside, a member's MarketBuy cannot be
         * matched to the row it should decrement, and every price stays as stale as the last dump.
         *
         * It was omitted on the first pass, and the omission was invisible: the data looked complete
         * right up until something tried to correlate against it.
         */
        marketId: typeof s.id === 'number' ? s.id : null,
        type: s.type ?? null,
        landingPads: s.landingPads ?? null,
        services: s.services ?? null,
        economy: s.primaryEconomy ?? null,
        economies: s.economies ?? null,
        government: s.government ?? null,
        controllingFaction: s.controllingFaction ?? null,
        /** Light seconds from the arrival point. The difference between a good and a useless run. */
        distanceToArrival: s.distanceToArrival ?? null,
        /*
         * Prices, demand and supply per commodity, plus when the market was last SEEN — which is
         * not when we ingested it. A price nobody has reported for a month should be treated
         * differently from one seen an hour ago, and only this field can tell them apart.
         */
        market: s.market?.commodities ?? null,
        marketUpdatedAt: s.market?.updateTime ?? null,
        updatedAt: s.updateTime ?? null,
      },
      coords,
    });
  }

  return rows;
}

/**
 * Streams the dump, handing batches of rows to a writer.
 *
 * ★ BATCHED, AND THE BATCH SIZE IS A REAL DECISION ★
 *
 * One insert per row would be tens of millions of round trips. One insert for everything would build
 * a statement larger than memory. A few thousand keeps each statement well inside Postgres's
 * parameter limit while making the round trips negligible.
 *
 * `onBatch` rather than returning rows: the caller writes and discards, so peak memory is one batch
 * rather than the whole galaxy.
 */
export async function streamGalaxy(
  path: string,
  onBatch: (rows: SystemRow[]) => Promise<void>,
  batchSize = 2_000,
): Promise<{ systems: number; stations: number; skipped: number }> {
  const stats = { systems: 0, stations: 0, skipped: 0 };
  let batch: SystemRow[] = [];

  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const rows = parseSystemLine(line);
    if (rows === null) {
      // Brackets and blank lines are expected; genuinely malformed records are not, and both land
      // here. Counted rather than logged per line — a corrupt file would otherwise write millions.
      stats.skipped += 1;
      continue;
    }

    for (const row of rows) {
      if (row.kind === 'system') stats.systems += 1;
      else stats.stations += 1;
    }

    batch.push(...rows);
    if (batch.length >= batchSize) {
      await onBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) await onBatch(batch);
  return stats;
}
