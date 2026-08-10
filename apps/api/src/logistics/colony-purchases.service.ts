import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AppError, CARRIER_STATION_TYPES, ErrorCode, looksLikeCarrier } from '@grims/shared';
import { commodityCategories } from './commodity-categories.js';
import { carrierCover, ColonyCarrierService } from './colony-carrier.service.js';

/**
 * A shopping ROUTE for one build — where to go, and what to get there.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * "a way to declare what station a commander purchased various materials from ... so that all
 * materials that have been found and delivered can be easily procurred without having to go hunt
 * them down"
 *
 * and, having then looked at the first version of it:
 *
 * "do not show fleet carriers in here at all! ... should only show materials for the specific
 * project at hand ... only show the closet stations not every station ... dont show duplicate
 * materials ... so we dont have people buying duplicte materials etc and showing up and they already
 * exist etc!"
 *
 * ★ WHAT THAT CHANGED, AND WHY IT HAD TO ★
 *
 * The first version was a RECORD: every station the squadron had ever bought at, with everything
 * ever bought there. As a record it is accurate and it is what was asked for. As a PLAN it sends
 * four people to four stations for the same Steel and a fifth for something delivered last week —
 * which is the outcome the owner's last sentence describes.
 *
 * So it became a route. Four rules, each from a failure they named:
 *
 *   1. NO FLEET CARRIERS, anywhere in it. A carrier is somewhere else tomorrow, so an entry naming
 *      one is a destination that has moved.
 *   2. ONLY THIS BUILD'S MATERIALS — not what was bought, what is still wanted.
 *   3. MINUS WHAT IS ALREADY COVERED. Delivered tonnage is out of `colony_needs` by definition, and
 *      whatever is sitting in an attached carrier's hold is subtracted here.
 *   4. EACH MATERIAL ONCE, at the stop that covers most of the rest.
 *
 * ★ TWO SOURCES, ONE OF THEM STORED ★
 *
 *   journal  every `MarketBuy` the app has sent — 1,181 of them across 128 stations before this
 *            existed, going back to March 2025.
 *   manual   somebody typing what they found: members without the app, purchases from before it,
 *            and "there is 30,000 t sitting here right now", which no journal can say.
 *
 * Manual wins, exactly as it does for carrier holds — the only thing a person can say that a journal
 * cannot is "that is wrong" or "it is gone now".
 */

/** One commodity at one station. */
export interface PurchaseLine {
  readonly commodity: string;
  readonly category: string | null;
  /** Tonnes, when anybody said. Null is "it is here" without a figure. */
  readonly tonnes: number | null;
  readonly price: number | null;
  readonly source: 'journal' | 'manual';
  /** Who bought or declared it. Null for a journal row whose member has since been removed. */
  readonly by: string | null;
  readonly at: Date;
  readonly note: string | null;
}

/** A stop somebody could fly to, before the route decides whether it is worth it. */
export interface RouteCandidate {
  readonly stationName: string;
  /** The station's OWN system — what a member pastes into the galaxy map. Never the build's. */
  readonly systemName: string;
  /** Light years from the build. Null when we cannot place one end of it. */
  readonly distanceLy: number | null;
  readonly lines: readonly PurchaseLine[];
}

/** A stop on the route, and what it is worth stopping for. */
export interface PurchaseStation extends RouteCandidate {
  /** Newest line here, so a reading nobody has refreshed in months reads as such. */
  readonly lastSeen: Date;
}

/**
 * How many stops a route may have.
 *
 * Twenty commodities each sold at exactly one station is a twenty-stop route, which is a list nobody
 * flies. Eight is a session: a hauler with a 720 t hold fills it several times over without the page
 * turning into a second job. What falls past the cap is returned as uncovered rather than dropped,
 * so the page can say so — a silent truncation would read as "that is everything".
 */
export const MAX_STOPS = 8;

/**
 * The key a station is filed under.
 *
 * ★ A CARRIER IS ONE PLACE — CAUGHT IN PRODUCTION, 2026-08-10 ★
 *
 * Exported so the rule can be tested without standing up telemetry. A fleet carrier is the one
 * station that changes system, so its market id matches several station records — and the live
 * catalogue showed `B2W-04T` twice, seventeen materials under Xinca and the same seventeen under
 * ICZ EW-V b2-4. Two destinations where there is one, and it is at neither any more.
 *
 * Carriers are excluded from the route outright now, but the rule stands for anything else whose
 * record we hold more than once.
 */
export function stationKey(name: string, system: string, marketId?: string): string {
  return marketId !== undefined && marketId !== '' ? `market:${marketId}` : `${system} ${name}`;
}

/**
 * The route: which stops, in what order, carrying what.
 *
 * ★ GREEDY SET COVER, AND WHY NOT NEAREST-FIRST ★
 *
 * The owner chose "whichever station covers the most of your list". Nearest-first minimises the jump
 * to the FIRST stop and says nothing about how many stops there are — a hauler would rather make one
 * visit at 40 ly than four at 5.
 *
 * So each round takes the stop covering the most still-uncovered materials, with the nearer winning
 * a tie. That is textbook greedy cover and good enough here: the optimum is NP-hard, and the gap
 * between greedy and optimal is far smaller than the error in a market reading taken last Tuesday.
 *
 * Pure, and exported, because this is the part that decides where nineteen people actually fly. It
 * must be testable without a database.
 */
export function planRoute(
  wanted: ReadonlySet<string>,
  candidates: readonly RouteCandidate[],
): { readonly stations: readonly PurchaseStation[]; readonly uncovered: readonly string[] } {
  const uncovered = new Set(wanted);
  const chosen: PurchaseStation[] = [];
  const visited = new Set<number>();

  while (uncovered.size > 0 && chosen.length < MAX_STOPS) {
    let bestAt = -1;
    let bestBrings: string[] = [];
    let bestLy = Infinity;

    for (let i = 0; i < candidates.length; i += 1) {
      if (visited.has(i)) continue;
      const candidate = candidates[i];
      if (candidate === undefined) continue;

      const brings = candidate.lines
        .map((l) => l.commodity)
        .filter((c) => uncovered.has(c));
      if (brings.length === 0) continue;

      // A station we cannot place must LOSE a tie, not win it: unknown is not nearer than 3 ly.
      const ly = candidate.distanceLy ?? Infinity;
      if (brings.length > bestBrings.length || (brings.length === bestBrings.length && ly < bestLy)) {
        bestAt = i;
        bestBrings = brings;
        bestLy = ly;
      }
    }

    // Nothing left adds anything new. What remains is genuinely unsourced and is reported as such.
    if (bestAt === -1) break;

    const best = candidates[bestAt] as RouteCandidate;
    visited.add(bestAt);

    const brings = new Set(bestBrings);
    const lines = best.lines
      .filter((l) => brings.has(l.commodity))
      .sort((a, b) => a.commodity.localeCompare(b.commodity));

    chosen.push({
      ...best,
      lines,
      lastSeen: lines.reduce((newest, l) => (l.at > newest ? l.at : newest), new Date(0)),
    });

    for (const c of bestBrings) uncovered.delete(c);
  }

  return { stations: chosen, uncovered: [...uncovered].sort() };
}

/** `steel` -> `Steel`. Frontier omits Type_Localised for exactly the plain-word commodities. */
function titleCase(raw: string): string {
  return raw
    .split(/([\s_-]+)/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}

@Injectable()
export class ColonyPurchasesService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(ColonyCarrierService) private readonly carriers: ColonyCarrierService,
  ) {}

  /**
   * Whether this project's catalogue should exist at all.
   *
   * ★ THE OWNER'S GATE, AND WHY IT NEEDS NO NEW FIELD ★
   *
   * "only for projects in systems that are being colonized by the commander that started the
   * colonization project". There is no "who colonises this system" column and there does not need to
   * be: measured on production, every system with projects has exactly ONE distinct poster. So the
   * coloniser IS the poster, and a system with two of them gets no catalogue and a where-to-buy
   * identical to the one before this shipped.
   */
  async visibleFor(projectId: string): Promise<{ systemName: string } | null> {
    const [row] = await this.db.$queryRawUnsafe<Array<{ system_name: string; posters: number }>>(
      `SELECT p.system_name,
              (SELECT count(DISTINCT q.posted_by_id)::int
                 FROM colony_projects q WHERE q.system_name = p.system_name) AS posters
         FROM colony_projects p WHERE p.id = $1::uuid`,
      projectId,
    );

    if (row === undefined) return null;
    return row.posters === 1 ? { systemName: row.system_name } : null;
  }

  /**
   * What this build still needs somebody to BUY.
   *
   * ★ RULE 3, AND WHY THE CARRIER HALF IS NOT DONE IN SQL ★
   *
   * `colony_needs.remaining` has already dropped everything delivered, so half of "hide what is
   * already covered" comes free with the data. The other half is what is sitting in an attached
   * carrier's hold, and three sources can speak about one commodity in one hold — a manual figure
   * beats both floors, including a manual zero that retires a stale claim.
   *
   * That rule is `carrierCover`, and it is a merge, not a sum. Writing it a second time in SQL here
   * is how the two would drift, so this asks the carrier service the same question the carriers tab
   * asks.
   */
  async #stillToBuy(projectId: string): Promise<Map<string, number>> {
    const needs = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT commodity, remaining FROM colony_needs
        WHERE project_id = $1::uuid AND remaining > 0`,
      projectId,
    );

    const cover = carrierCover(await this.carriers.forProject(projectId));

    const wanted = new Map<string, number>();
    for (const row of needs) {
      const commodity = String(row['commodity']);
      const left = Number(row['remaining'] ?? 0) - (cover[commodity] ?? 0);
      if (left > 0) wanted.set(commodity, left);
    }
    return wanted;
  }

  /**
   * The route for one build.
   *
   * Returns the stops worth flying to and, separately, the materials that are on none of them —
   * because a route that quietly omits Ceramic Composites reads as "you can buy everything here",
   * and somebody flies the whole trip and comes home still needing it.
   */
  async forProject(projectId: string): Promise<{
    readonly systemName: string;
    readonly stations: readonly PurchaseStation[];
    /** Wanted, but on no stop of this route. Said plainly rather than omitted. */
    readonly uncovered: readonly string[];
  }> {
    const [project] = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT system_name FROM colony_projects WHERE id = $1::uuid`,
      projectId,
    );
    const systemName = String(project?.['system_name'] ?? '');
    if (systemName === '') return { systemName: '', stations: [], uncovered: [] };

    const wanted = await this.#stillToBuy(projectId);
    if (wanted.size === 0) return { systemName, stations: [], uncovered: [] };

    const categories = await commodityCategories(this.db);

    /*
     * ★ CARRIERS ARE EXCLUDED IN SQL, NOT AFTER THE FACT ★
     *
     * 52,763 of the ~318,000 station rows on production are carriers. Filtering them here means one
     * can never reach the ranking at all, and the LIMIT below is spent on places that still exist.
     * The name check in `offer` is the second net, for the 37 carrier-shaped rows with no type and
     * for anything typed in by hand.
     */
    const journal = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH origin AS (
         SELECT coords FROM knowledge_items
          WHERE kind = 'system' AND name = $1 AND coords IS NOT NULL LIMIT 1)
       SELECT k.name                        AS station_name,
              k.data->>'system'             AS station_system,
              k.data->>'type'               AS station_type,
              t.payload->>'MarketID'        AS market_id,
              t.payload->>'Type'            AS raw_type,
              t.payload->>'Type_Localised'  AS localised,
              (t.payload->>'Count')::int    AS tonnes,
              (t.payload->>'BuyPrice')::int AS price,
              u.display_name                AS bought_by,
              t.occurred_at                 AS at,
              CASE WHEN k.coords IS NULL OR (SELECT coords FROM origin) IS NULL THEN NULL
                   ELSE round((k.coords <-> (SELECT coords FROM origin))::numeric, 1) END AS ly
         FROM telemetry_events t
         JOIN users u ON u.id = t.user_id
         JOIN knowledge_items k
           ON k.kind = 'station' AND k.data->>'marketId' = t.payload->>'MarketID'
        WHERE t.event_type = 'MarketBuy'
          AND COALESCE(k.data->>'type', '') <> ALL ($2::text[])
          /*
           * Only members BUILDING here. As a JOIN this fanned out — a poster with four projects in
           * one system multiplied every purchase they had ever made by four, turning one 85 t
           * Ceramic Composites line into four. Caught by running it, not by reading it.
           */
          AND EXISTS (SELECT 1 FROM colony_projects p
                       WHERE p.posted_by_id = t.user_id AND p.system_name = $1)
        ORDER BY t.occurred_at DESC
        LIMIT 4000`,
      systemName,
      CARRIER_STATION_TYPES,
    );

    const manual = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH origin AS (
         SELECT coords FROM knowledge_items
          WHERE kind = 'system' AND name = $1 AND coords IS NOT NULL LIMIT 1)
       SELECT c.station_name, c.station_system, c.commodity, c.tonnes, c.price, c.note,
              u.display_name AS bought_by, c.updated_at AS at,
              CASE WHEN s.coords IS NULL OR (SELECT coords FROM origin) IS NULL THEN NULL
                   ELSE round((s.coords <-> (SELECT coords FROM origin))::numeric, 1) END AS ly
         FROM colony_purchases c
         LEFT JOIN users u ON u.id = c.declared_by_id
         LEFT JOIN LATERAL (
           SELECT coords FROM knowledge_items
            WHERE kind = 'system' AND name = c.station_system AND coords IS NOT NULL LIMIT 1
         ) s ON true
        WHERE c.system_name = $1`,
      systemName,
    );

    interface Place {
      readonly name: string;
      readonly system: string;
      ly: number | null;
      readonly lines: Map<string, PurchaseLine>;
    }
    const places = new Map<string, Place>();

    const offer = (
      name: string,
      system: string,
      type: string | null,
      ly: number | null,
      line: PurchaseLine,
      marketId?: string,
    ): void => {
      // Rule 1. Second net: the type column is not always filled in, and a hand-typed row has none.
      if (looksLikeCarrier(name, type)) return;
      // Rules 2 and 3: if this build does not still want it, it is not on the route.
      if (!wanted.has(line.commodity)) return;

      const key = stationKey(name, system, marketId);
      let place = places.get(key);
      if (place === undefined) {
        place = { name, system, ly, lines: new Map<string, PurchaseLine>() };
        places.set(key, place);
      } else if (place.ly === null) {
        place.ly = ly;
      }

      const held = place.lines.get(line.commodity);
      // Manual beats journal; between two of a kind the newer wins. Same rule as carrier holds.
      const beats =
        held === undefined ||
        (line.source === 'manual' && held.source === 'journal') ||
        (line.source === held.source && line.at > held.at);
      if (beats) place.lines.set(line.commodity, line);
    };

    for (const row of journal) {
      /*
       * ★ THE SAME NAME FIX THE CARRIER HOLDS NEEDED ★
       *
       * Frontier omits `Type_Localised` for exactly the commodities whose symbol is the plain word,
       * so these arrive as `steel`, `aluminium`, `titanium` — the three most-bought commodities in
       * the table. Left raw they match no need, no category and no shopping row, and the page looks
       * broken for precisely the materials it exists to help with.
       */
      const localised = String(row['localised'] ?? '').trim();
      const commodity =
        localised !== '' ? localised : titleCase(String(row['raw_type'] ?? '').trim());
      if (commodity === '') continue;

      offer(
        String(row['station_name']),
        String(row['station_system'] ?? 'unknown'),
        row['station_type'] === null ? null : String(row['station_type']),
        row['ly'] === null || row['ly'] === undefined ? null : Number(row['ly']),
        {
          commodity,
          category: categories.get(commodity) ?? null,
          tonnes: row['tonnes'] === null ? null : Number(row['tonnes']),
          price: row['price'] === null ? null : Number(row['price']),
          source: 'journal',
          by: row['bought_by'] === null ? null : String(row['bought_by']),
          at: new Date(String(row['at'])),
          note: null,
        },
        String(row['market_id'] ?? ''),
      );
    }

    for (const row of manual) {
      offer(
        String(row['station_name']),
        String(row['station_system']),
        null,
        row['ly'] === null || row['ly'] === undefined ? null : Number(row['ly']),
        {
          commodity: String(row['commodity']),
          category: categories.get(String(row['commodity'])) ?? null,
          tonnes: row['tonnes'] === null ? null : Number(row['tonnes']),
          price: row['price'] === null ? null : Number(row['price']),
          source: 'manual',
          by: row['bought_by'] === null ? null : String(row['bought_by']),
          at: new Date(String(row['at'])),
          note: row['note'] === null ? null : String(row['note']),
        },
      );
    }

    const route = planRoute(
      new Set(wanted.keys()),
      [...places.values()].map((p) => ({
        stationName: p.name,
        systemName: p.system,
        distanceLy: p.ly,
        lines: [...p.lines.values()],
      })),
    );

    return { systemName, stations: route.stations, uncovered: route.uncovered };
  }

  /** Records what somebody found. Re-declaring the same commodity at the same station updates it. */
  async declare(input: {
    systemName: string;
    stationName: string;
    stationSystem: string;
    commodity: string;
    tonnes: number | null;
    price: number | null;
    note: string | null;
    userId: string;
  }): Promise<{ ok: true }> {
    const clean = (v: string, max: number): string => v.trim().slice(0, max);

    const stationName = clean(input.stationName, 80);
    const stationSystem = clean(input.stationSystem, 80);
    const commodity = clean(input.commodity, 60);

    if (stationName === '' || stationSystem === '' || commodity === '') {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Name the commodity, the station and the system it is in.',
      );
    }

    /*
     * ★ REFUSED AT THE DOOR, NOT FILTERED ON THE WAY OUT ★
     *
     * "do not show fleet carriers in here at all". A declaration naming a carrier would be stored,
     * hidden by the reader, and look to the member who typed it like the save had failed. Saying so
     * here is the honest version, and it is the only place a person can name a station by hand.
     */
    if (looksLikeCarrier(stationName, null)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That is a fleet carrier. It will have moved by the time somebody flies out, so the ' +
          'catalogue only lists stations — put carrier stock on the Carriers tab instead.',
      );
    }

    await this.db.$executeRawUnsafe(
      `INSERT INTO colony_purchases
         (system_name, station_name, station_system, commodity, tonnes, price, note,
          declared_by_id, declared_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, now(), now())
       ON CONFLICT (system_name, station_name, commodity, declared_by_id) DO UPDATE SET
         station_system = EXCLUDED.station_system,
         tonnes = EXCLUDED.tonnes,
         price = EXCLUDED.price,
         note = EXCLUDED.note,
         updated_at = now()`,
      clean(input.systemName, 80),
      stationName,
      stationSystem,
      commodity,
      input.tonnes,
      input.price,
      input.note === null ? null : clean(input.note, 200),
      input.userId,
    );

    return { ok: true };
  }

  /**
   * Removes a declaration.
   *
   * Scoped to the declarer's own rows. A catalogue anybody can delete from is one nobody can rely
   * on, and the entry is a statement of what THEY found — correcting somebody else's is done by
   * adding your own, which the merge then shows beside theirs.
   */
  async withdraw(input: {
    systemName: string;
    stationName: string;
    commodity: string;
    userId: string;
  }): Promise<{ ok: true }> {
    await this.db.$executeRawUnsafe(
      `DELETE FROM colony_purchases
        WHERE system_name = $1 AND station_name = $2 AND commodity = $3 AND declared_by_id = $4::uuid`,
      input.systemName,
      input.stationName,
      input.commodity,
      input.userId,
    );
    return { ok: true };
  }
}
