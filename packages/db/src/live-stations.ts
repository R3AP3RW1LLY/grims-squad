import type { PrismaClient } from '@prisma/client';

/**
 * Stations learned from the live feeds, added in full.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "if we dont know the station we need to add it in full!! this is non-negotiable! this is data we
 * can use to grow and leverage our system!"
 *
 * ★ WHAT USED TO HAPPEN ★
 *
 * A market for a station we did not hold was counted, queued into `pending_stations`, and the
 * prices — every one of them — discarded. The queue's drainer was scheduled only in a crontab that
 * was never installed, so it had 1,323 rows, zero resolved, zero attempts. About a hundred markets
 * a window, thrown away for ever. And the stations affected are exactly the interesting ones: a
 * carrier that jumped since the last dump, a construction site laid down this morning, a system
 * Spansh has not indexed yet.
 *
 * ★ THE KEY IS THE MARKET ID, AND IT IS STABLE ON PURPOSE ★
 *
 * Galaxy stations are keyed `"<systemAddress>/<stationName>"`. A live sighting has neither piece
 * reliably: commodity/3 carries no system address at all, and carrier names change. The market id
 * is the one identifier every source shares and no station changes, so a provisional row is keyed
 * `live:<marketId>` — and because that never changes, enrichment (a Docked event filling in type
 * and pads) UPDATES the same row rather than creating a second identity whose market rows would
 * then exist under two keys.
 *
 * When the galaxy dump later learns the same station, the provisional row is retired and its
 * market rows are migrated to the galaxy key — one deterministic moment, both keys known.
 *
 * ★ UNKNOWNS ARE UNKNOWN, NOT ZERO ★
 *
 * The owner chose "immediately, honest about unknowns": prices appear the moment we learn them,
 * and pads we cannot vouch for are `-1` — excluded by the large-pad filter (`large_pads > 0`), so
 * nobody is sent somewhere their ship cannot land, and distinguishable from a genuine zero so a
 * page can say "pads unknown" instead of lying in either direction.
 */

/** The shape both market writers already use. */
export interface LiveStation {
  readonly key: string;
  readonly name: string;
  readonly system: string;
  readonly type: string | null;
  /** -1 means unknown — see above. Real pad counts are always >= 0. */
  readonly pads: number;
}

export const PROVISIONAL_PREFIX = 'live:';

/** Everything a Docked event can teach us about a station. */
export interface DockFacts {
  readonly marketId: number;
  readonly stationName: string;
  readonly systemName: string;
  readonly systemAddress: number | null;
  readonly stationType: string | null;
  /** Large pads, when the event carries LandingPads. Null when it does not. */
  readonly largePads: number | null;
  readonly distFromStarLs: number | null;
}

/**
 * Ensures a station exists for this market id, creating a provisional one if need be.
 *
 * Returns the station to write market rows under — the galaxy one when we hold it, the provisional
 * one otherwise. Never null: that is the whole point.
 */
export async function ensureLiveStation(
  db: PrismaClient,
  sighting: { marketId: number; stationName: string; systemName: string },
): Promise<LiveStation> {
  const known = await lookupByMarketId(db, sighting.marketId);
  if (known !== null) return known;

  const key = `${PROVISIONAL_PREFIX}${sighting.marketId}`;

  /*
   * Coordinates from the system, by name — accepted only when the name is UNAMBIGUOUS. System
   * names are not unique in Elite (procedural sectors repeat them), and wrong coordinates would
   * put the station in every "within N ly" answer for the wrong place, which is worse than
   * absent. An ambiguous or unknown name leaves coords NULL; the station still appears in every
   * non-spatial answer, and an FSDJump teaching us the system fills coords in later.
   */
  await db.$executeRawUnsafe(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text, ingested_at)
     VALUES (
       'eddn', 'station', $1, $2,
       jsonb_build_object(
         'marketId', $3::text,
         'system', $4::text,
         'provisional', true,
         'firstSeenAt', now()
       ),
       (SELECT s.coords FROM knowledge_items s
         WHERE s.source IN ('galaxy', 'eddn') AND s.kind = 'system'
           AND s.name = $4 AND s.coords IS NOT NULL
         GROUP BY s.coords
         HAVING count(*) = (SELECT count(*) FROM knowledge_items t
                             WHERE t.source IN ('galaxy', 'eddn') AND t.kind = 'system'
                               AND t.name = $4 AND t.coords IS NOT NULL)
         LIMIT 1),
       $5,
       now()
     )
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET
       -- Carriers get renamed; the newest sighting's name is the current one.
       name = EXCLUDED.name,
       data = knowledge_items.data || jsonb_build_object('system', $4::text),
       ingested_at = now()`,
    key,
    sighting.stationName,
    String(sighting.marketId),
    sighting.systemName,
    // A sentence, because knowledge rows are embedded and retrieved as text by the assistant.
    `${sighting.stationName} is a station in ${sighting.systemName}, first seen live on the market feed.`,
  );

  return {
    key,
    name: sighting.stationName,
    system: sighting.systemName,
    type: null,
    pads: -1,
  };
}

/**
 * A Docked event carries everything but coordinates — the "in full" the owner asked for.
 *
 * Three cases, in order:
 *  - We hold the GALAXY station: refresh its type/pads from the live sighting (fresher than any
 *    dump), and if a provisional twin exists from before the dump learned it, retire the twin and
 *    migrate its market rows to the galaxy key.
 *  - We hold a PROVISIONAL row: enrich it in place. The key never changes, so its market rows need
 *    no migration.
 *  - We hold NOTHING: create the provisional row already enriched.
 */
export async function enrichStationFromDock(db: PrismaClient, dock: DockFacts): Promise<void> {
  const key = `${PROVISIONAL_PREFIX}${dock.marketId}`;

  const rows = await db.$queryRawUnsafe<Array<{ source: string; ext_key: string }>>(
    `SELECT source, ext_key FROM knowledge_items
      WHERE kind = 'station' AND data->>'marketId' = $1
        AND source IN ('galaxy', 'eddn')`,
    String(dock.marketId),
  );

  const galaxy = rows.find((r) => r.source === 'galaxy') ?? null;
  const provisional = rows.find((r) => r.source === 'eddn') ?? null;

  if (galaxy !== null) {
    /*
     * A live dock outranks any dump for the mutable facts. Written into the galaxy row knowing the
     * next ingest may overwrite it — by then the dump itself is newer than this sighting.
     */
    await db.$executeRawUnsafe(
      `UPDATE knowledge_items SET
         data = data || jsonb_strip_nulls(jsonb_build_object(
           'type', $2::text,
           'landingPads', CASE WHEN $3::int IS NULL THEN NULL
                               ELSE jsonb_build_object('large', $3::int) END,
           'distanceToArrival', $4::float8
         )),
         ingested_at = now()
       WHERE source = 'galaxy' AND kind = 'station' AND ext_key = $1`,
      galaxy.ext_key,
      dock.stationType,
      dock.largePads,
      dock.distFromStarLs,
    );

    if (provisional !== null) {
      /*
       * The dump has caught up with a station we learned live. One deterministic hand-over: the
       * market rows move to the galaxy key and the provisional identity is retired, so no station
       * ever answers under two keys.
       */
      await db.$executeRawUnsafe(
        `UPDATE market_entries SET station_key = $1 WHERE station_key = $2`,
        galaxy.ext_key,
        key,
      );
      await db.$executeRawUnsafe(
        `DELETE FROM knowledge_items WHERE source = 'eddn' AND kind = 'station' AND ext_key = $1`,
        key,
      );
    }

    await markPendingResolved(db, dock.marketId);
    return;
  }

  await db.$executeRawUnsafe(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text, ingested_at)
     VALUES (
       'eddn', 'station', $1, $2,
       jsonb_strip_nulls(jsonb_build_object(
         'marketId', $3::text,
         'system', $4::text,
         'systemAddress', $5::text,
         'type', $6::text,
         'landingPads', CASE WHEN $7::int IS NULL THEN NULL
                             ELSE jsonb_build_object('large', $7::int) END,
         'distanceToArrival', $8::float8,
         'provisional', true,
         'firstSeenAt', now()
       )),
       COALESCE(
         (SELECT s.coords FROM knowledge_items s
           WHERE s.source IN ('galaxy', 'eddn') AND s.kind = 'system' AND s.ext_key = $5
           LIMIT 1),
         (SELECT s.coords FROM knowledge_items s
           WHERE s.source IN ('galaxy', 'eddn') AND s.kind = 'system'
             AND s.name = $4 AND s.coords IS NOT NULL
           GROUP BY s.coords
           HAVING count(*) = (SELECT count(*) FROM knowledge_items t
                               WHERE t.source IN ('galaxy', 'eddn') AND t.kind = 'system'
                                 AND t.name = $4 AND t.coords IS NOT NULL)
           LIMIT 1)
       ),
       $9,
       now()
     )
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET
       name = EXCLUDED.name,
       data = knowledge_items.data || EXCLUDED.data,
       coords = COALESCE(EXCLUDED.coords, knowledge_items.coords),
       ingested_at = now()`,
    key,
    dock.stationName,
    String(dock.marketId),
    dock.systemName,
    dock.systemAddress === null ? null : String(dock.systemAddress),
    dock.stationType,
    dock.largePads,
    dock.distFromStarLs,
    `${dock.stationName} is a ${dock.stationType ?? 'station'} in ${dock.systemName}, seen live on the journal feed.`,
  );

  /*
   * The dock may have taught us coordinates a commodity-only sighting could not. Any market rows
   * already written under the provisional key were saved with NULL coords and invisible to every
   * radius search — backfill them so they start being found.
   */
  await db.$executeRawUnsafe(
    `UPDATE market_entries m
        SET coords = k.coords
       FROM knowledge_items k
      WHERE m.station_key = $1 AND m.coords IS NULL
        AND k.source = 'eddn' AND k.kind = 'station' AND k.ext_key = $1
        AND k.coords IS NOT NULL`,
    key,
  );

  await markPendingResolved(db, dock.marketId);
}

/**
 * Looks a market id up across BOTH sources, galaxy preferred.
 *
 * Galaxy first because when both exist the galaxy row carries coordinates and the full record; the
 * provisional twin is retired at the next dock anyway.
 */
export async function lookupByMarketId(
  db: PrismaClient,
  marketId: number,
): Promise<LiveStation | null> {
  const rows = await db.$queryRawUnsafe<
    Array<{ ext_key: string; name: string; system: string | null; type: string | null; pads: number | null; source: string }>
  >(
    `SELECT ext_key, name,
            data->>'system' AS system,
            data->>'type'   AS type,
            (data->'landingPads'->>'large')::int AS pads,
            source
       FROM knowledge_items
      WHERE kind = 'station' AND source IN ('galaxy', 'eddn')
        AND data->>'marketId' = $1
      ORDER BY CASE source WHEN 'galaxy' THEN 0 ELSE 1 END
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
    // A galaxy station without pad data genuinely has none recorded (0 was the old behaviour); a
    // provisional one has UNKNOWN pads, which is a different claim.
    pads: r.pads ?? (r.source === 'eddn' ? -1 : 0),
  };
}

/** The queue kept its purpose — it feeds the Spansh-side resolver — but a dock settles the entry. */
async function markPendingResolved(db: PrismaClient, marketId: number): Promise<void> {
  await db
    .$executeRawUnsafe(`DELETE FROM pending_stations WHERE market_id = $1`, marketId)
    .catch(() => undefined);
}
