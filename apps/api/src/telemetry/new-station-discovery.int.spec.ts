import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { applyMarketEvent } from './market-live.js';

/**
 * The squadron's own newest station, docked at for the first time.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we have a new ground station we built in game, but after we landed there and opened the market,
 * it is not listing anywhere that we can buy commodities from it, we need to add this feature so
 * that if we land at a station thats not been seen before it adds it to our website and app /
 * database etc."
 *
 * ★ WHY THIS TEST EXISTS RATHER THAN NEW CODE ★
 *
 * The self-registration it asks for was already written: `ensureLiveStation` creates a provisional
 * station on first sight, taking coordinates from its system. What was missing is a test of the
 * WHOLE path — an unknown MarketID arriving with a hold full of prices — and the whole path is
 * where the failure actually lived.
 *
 * The station a member is most likely to be first at is, by definition, one nothing else in the
 * galaxy has catalogued: the squadron's own construction. Spansh's nightly dump will not have it,
 * so "wait for the next ingest" is not a plan — it is why the owner's new port was invisible.
 *
 * ★ COORDINATES ARE THE HALF THAT SILENTLY FAILS ★
 *
 * A station row with NULL coords still answers "what does this station sell" and is still missing
 * from every "within N light years" search — which is most of how anybody actually finds a place to
 * buy. So this asserts on the coordinates, not merely on the rows existing.
 */

const db = new PrismaClient();

/** A market id no station holds, well outside Frontier's range, so nothing real can collide. */
const MARKET_ID = 9_000_000_123_456;
const STATION = 'Grim Test Outpost';

async function cleanUp(system: string): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM market_entries WHERE station_key LIKE 'live:' || $1 || '%'`,
    String(MARKET_ID),
  );
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE kind = 'station' AND ext_key LIKE 'live:' || $1 || '%'`,
    String(MARKET_ID),
  );
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE kind = 'system' AND name = $1 AND source = 'eddn'`,
    system,
  );
}

describe('docking at a station nothing has ever catalogued', () => {
  it(
    'registers the station from the journal and makes its market findable by distance',
    async () => {
      /*
       * A real system from the galaxy dump, so the coordinate lookup has something honest to find.
       * Picked at query time rather than hard-coded: a name that happened to be ambiguous would
       * make this fail for a reason that is not a defect (see the note on ambiguity in
       * `ensureLiveStation`).
       */
      /*
       * ★ SEEDED, NOT BORROWED — CAUGHT BY CI ★
       *
       * This used to take any unambiguous galaxy row and throw when it found none. A fresh CI
       * database has no galaxy dump and never will, so the spec was red by construction there and
       * green here purely because this machine has the dump loaded.
       *
       * Seeding guarantees the unambiguity the test needs rather than hoping for it — the name is
       * this spec's own, so nothing else can collide with it.
       */
      const system = 'new-station-discovery-int-spec System';
      await db.$executeRawUnsafe(
        `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
         VALUES ('galaxy', 'system', $1, $2, '{}'::jsonb, cube(array[7.0, 8.0, 9.0]), $2)
         ON CONFLICT (source, kind, ext_key) DO UPDATE SET coords = EXCLUDED.coords`,
        '900000000000003',
        system,
      );

      await cleanUp(system);

      try {
        const written = await applyMarketEvent(db, {
          event: 'Market',
          MarketID: MARKET_ID,
          StationName: STATION,
          StarSystem: system,
          /*
           * ★ THE ITEMS ARE THE WHOLE THING ★
           *
           * The `Market` JOURNAL event carries no prices — they live in `Market.json` beside it.
           * The companion attaching them is what makes this a snapshot rather than an announcement
           * that a market exists, and their absence is why this path had never once written a row
           * in production.
           */
          Items: [
            {
              Name: '$painite_name;',
              Name_Localised: 'Painite',
              Category_Localised: 'Minerals',
              BuyPrice: 0,
              SellPrice: 505_000,
              Stock: 0,
              Demand: 1_200,
            },
            {
              Name: '$tritium_name;',
              Name_Localised: 'Tritium',
              Category_Localised: 'Chemicals',
              BuyPrice: 51_000,
              SellPrice: 49_000,
              Stock: 9_000,
              Demand: 0,
            },
          ],
        });

        expect(written, 'an unknown station wrote no market rows at all').toBe(2);

        // ---- the station now exists in our own catalogue ----
        const [station] = await db.$queryRawUnsafe<
          Array<{ name: string; provisional: boolean | null; has_coords: boolean }>
        >(
          `SELECT name,
                  (data->>'provisional')::boolean AS provisional,
                  (coords IS NOT NULL) AS has_coords
             FROM knowledge_items
            WHERE kind = 'station' AND data->>'marketId' = $1`,
          String(MARKET_ID),
        );

        expect(station?.name, 'the station was not added to the catalogue').toBe(STATION);
        expect(station?.provisional, 'it was not marked provisional').toBe(true);
        expect(
          station?.has_coords,
          'the station has no coordinates, so it is invisible to every distance search',
        ).toBe(true);

        // ---- and it is findable the way a member would actually look ----
        const rows = await db.$queryRawUnsafe<
          Array<{ commodity: string; source: string; has_coords: boolean }>
        >(
          `SELECT commodity, source, (coords IS NOT NULL) AS has_coords
             FROM market_entries
            WHERE station_name = $1
            ORDER BY commodity`,
          STATION,
        );

        expect(rows.map((r) => r.commodity)).toEqual(['Painite', 'Tritium']);
        // 'journal' is what marks a row as one of OUR members' observations rather than a dump.
        expect(rows.every((r) => r.source === 'journal')).toBe(true);
        expect(
          rows.every((r) => r.has_coords),
          'the market rows carry no coordinates, so no proximity search can return them',
        ).toBe(true);
      } finally {
        await cleanUp(system);
        // The seeded galaxy row: this spec created it, so this spec removes it.
        await db.$executeRawUnsafe(
          `DELETE FROM knowledge_items WHERE kind = 'system' AND ext_key = $1`,
          '900000000000003',
        );
        await db.$disconnect();
      }
    },
    60_000,
  );
});
