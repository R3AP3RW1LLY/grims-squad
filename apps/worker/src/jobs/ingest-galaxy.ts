import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { cleanStationName } from '@grims/shared';

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
  /** A sentence describing the row. Embedded, and what the assistant reads. */
  readonly text: string;
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
      /*
       * ★ A SENTENCE, SO THE ROW CAN BE EMBEDDED AND READ ★
       *
       * Structured rows carried no text at all, which meant they could not be embedded — and when
       * the assistant did retrieve one it was handed raw JSON and paraphrased a data structure.
       *
       * Written at INGEST rather than at query time so it is embedded and retrieved as the same
       * words. A summary generated per request would drift from the vector that found it.
       */
      text: describeSystem(name, raw),
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
      /*
       * Namespaced by system: station names repeat across the galaxy constantly.
       *
       * ★ BUILT FROM THE RAW NAME, DELIBERATELY — 2026-08-09 ★
       *
       * The display name below is cleaned; this key must NOT be. It is the station's identity, it
       * is already stored on 882 galaxy rows and on every `market_entries.station_key` derived from
       * them, and recomputing it from the cleaned name would not rename those stations — it would
       * create a second one beside each, with the market rows split between the two.
       */
      extKey: `${id64}/${sName}`,
      /*
       * ★ THE DUMP CARRIES THE GAME'S LOCALISATION KEYS ★
       *
       * 882 stations in the galaxy dump are named `$EXT_PANEL_ColonisationShip; <name>`, and a
       * further variant `$EXT_PANEL_ColonisationShip:#index=1;` for the unnamed ones. That is how a
       * member's colonisation project came to be labelled `$EXT_PANEL_ColonisationShip; Mitra
       * Horizons` on the site.
       *
       * Cleaning it at the live doors alone would not have held: `market_entries.station_name` is
       * copied from `knowledge_items.name` on every rebuild, so the dump would have put the key
       * back every night.
       */
      name: cleanStationName(sName),
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
      text: describeStation(sName, name, s),
    });
  }

  return rows;
}

/** One system, as a sentence. Only what somebody would actually ask about. */
function describeSystem(name: string, raw: RawSystem): string {
  const bits = [`${name} is a star system`];
  if (typeof raw.allegiance === 'string') bits.push(`aligned to ${raw.allegiance}`);
  if (typeof raw.government === 'string') bits.push(`under ${raw.government} government`);
  if (typeof raw.primaryEconomy === 'string') bits.push(`with a ${raw.primaryEconomy} economy`);
  if (typeof raw.security === 'string') bits.push(`and ${raw.security} security`);

  const parts = [`${bits.join(', ')}.`];
  if (typeof raw.population === 'number' && raw.population > 0) {
    parts.push(`Population ${raw.population.toLocaleString()}.`);
  }
  if (typeof raw.controllingFaction?.name === 'string') {
    parts.push(`Controlled by ${raw.controllingFaction.name}.`);
  }
  const stations = Array.isArray(raw.stations) ? raw.stations.length : 0;
  if (stations > 0) parts.push(`${stations} station${stations === 1 ? '' : 's'}.`);
  return parts.join(' ');
}

/** One station, as a sentence. The pad size is first because it decides whether you can go. */
function describeStation(
  station: string,
  system: string,
  s: { type?: unknown; landingPads?: unknown; services?: unknown; primaryEconomy?: unknown; distanceToArrival?: unknown },
): string {
  /*
   * "an Outpost", not "a Outpost". Most station types in Elite begin with a vowel — Outpost, Orbis,
   * Ocellus, Asteroid base — so getting this wrong is wrong on the MAJORITY of 305,865 rows, and
   * this text is both what gets embedded and what the assistant reads back to a member.
   */
  const type = typeof s.type === 'string' ? s.type : 'station';
  const article = /^[aeiou]/i.test(type) ? 'an' : 'a';
  const parts = [`${station} is ${article} ${type} in ${system}.`];

  const pads = s.landingPads as { large?: unknown } | undefined;
  const large = typeof pads?.large === 'number' ? pads.large : 0;
  // Named either way. "No large pad" is the answer to a question people ask constantly, and its
  // absence from the text would make the row useless for exactly that question.
  parts.push(large > 0 ? `It has ${large} large landing pad${large === 1 ? '' : 's'}.` : 'It has no large landing pad.');

  if (typeof s.primaryEconomy === 'string') parts.push(`Economy: ${s.primaryEconomy}.`);
  if (typeof s.distanceToArrival === 'number') {
    parts.push(`${Math.round(s.distanceToArrival).toLocaleString()} ls from arrival.`);
  }
  if (Array.isArray(s.services) && s.services.length > 0) {
    parts.push(`Services: ${s.services.filter((x) => typeof x === 'string').join(', ')}.`);
  }
  return parts.join(' ');
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
