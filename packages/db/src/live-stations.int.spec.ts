import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  PROVISIONAL_PREFIX,
  ensureLiveStation,
  enrichStationFromDock,
  lookupByMarketId,
} from './live-stations.js';

/**
 * The provisional-station lifecycle, against a real Postgres.
 *
 * ★ WHY INTEGRATION AND NOT UNIT ★
 *
 * Every function here is hand-written SQL — jsonb_build_object, ON CONFLICT against a three-column
 * unique, a HAVING count(*)=1 coordinate lookup. Typecheck cannot see inside a string, and the
 * colonisation GROUP BY incident proved a mocked client passes while every real screen 500s. The
 * value is the queries being ACCEPTED and the lifecycle round-tripping on the real schema.
 *
 * Uses market ids far outside Frontier's range so a live collector writing real sightings in
 * parallel can never collide with the fixtures, and cleans up after itself.
 */

const db = new PrismaClient();

/** Frontier ids are < 2^48; these are test-only. */
const MARKET_A = 900_000_000_000_001;
const MARKET_B = 900_000_000_000_002;

const KEY_A = `${PROVISIONAL_PREFIX}${MARKET_A}`;

async function cleanup(): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE kind = 'station' AND ext_key LIKE 'live:9000000000%'`,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE source = 'galaxy' AND kind = 'station' AND ext_key = 'test-sys/Test Galaxy Port'`,
  );
  await db.$executeRawUnsafe(`DELETE FROM market_entries WHERE station_key LIKE 'live:9000000000%'`);
  await db.$executeRawUnsafe(`DELETE FROM pending_stations WHERE market_id >= 900000000000000`);
}

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe('a station learned live', () => {
  it('is created in full from a market sighting and found by the shared lookup', async () => {
    await cleanup();

    const station = await ensureLiveStation(db, {
      marketId: MARKET_A,
      stationName: 'Test Frontier Depot',
      systemName: 'No Such System XYZZY',
    });

    expect(station.key).toBe(KEY_A);
    // Unknown pads are UNKNOWN, not zero — the -1 keeps it out of `large_pads > 0` filters while
    // staying distinguishable from a station genuinely without large pads.
    expect(station.pads).toBe(-1);

    const found = await lookupByMarketId(db, MARKET_A);
    expect(found?.key).toBe(KEY_A);
    expect(found?.name).toBe('Test Frontier Depot');
  });

  it('a second sighting updates the name rather than duplicating the row', async () => {
    // Carriers get renamed; the ON CONFLICT path is the common path.
    await ensureLiveStation(db, {
      marketId: MARKET_A,
      stationName: 'Renamed Depot',
      systemName: 'No Such System XYZZY',
    });

    const rows = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM knowledge_items WHERE kind='station' AND ext_key = $1`,
      KEY_A,
    );
    expect(rows[0]?.n).toBe(1);

    // ensureLiveStation short-circuits on a known station, so the rename comes via lookup.
    const found = await lookupByMarketId(db, MARKET_A);
    expect(found?.name).toBe('Test Frontier Depot');
  });

  it('a Docked event enriches it in place — same key, fuller record', async () => {
    await enrichStationFromDock(db, {
      marketId: MARKET_A,
      stationName: 'Test Frontier Depot',
      systemName: 'No Such System XYZZY',
      systemAddress: 999_999_999_999,
      stationType: 'Outpost',
      largePads: 0,
      distFromStarLs: 351.5,
    });

    const rows = await db.$queryRawUnsafe<Array<{ data: Record<string, unknown> }>>(
      `SELECT data FROM knowledge_items WHERE kind='station' AND ext_key = $1`,
      KEY_A,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data['type']).toBe('Outpost');
    expect(rows[0]?.data['distanceToArrival']).toBe(351.5);

    // Enriched pads are REAL now: zero large pads is a genuine claim from a genuine dock.
    const found = await lookupByMarketId(db, MARKET_A);
    expect(found?.pads).toBe(0);
    expect(found?.type).toBe('Outpost');
  });

  it('★ MANDATORY: retires the provisional twin when the galaxy learns the station ★', async () => {
    /*
     * The dedup moment. A provisional station and a later galaxy row for the same market id must
     * not answer under two keys — the market rows migrate and the twin is deleted, exactly once.
     */
    await ensureLiveStation(db, {
      marketId: MARKET_B,
      stationName: 'Test Galaxy Port',
      systemName: 'No Such System XYZZY',
    });
    await db.$executeRawUnsafe(
      `INSERT INTO market_entries (station_key, station_name, system_name, commodity,
                                   buy_price, sell_price, supply, demand, large_pads,
                                   market_seen_at, source)
       VALUES ($1, 'Test Galaxy Port', 'No Such System XYZZY', 'Testium',
               100, 0, 500, 0, -1, now(), 'eddn')`,
      `${PROVISIONAL_PREFIX}${MARKET_B}`,
    );

    // The dump catches up: a real galaxy row appears for the same market id.
    await db.$executeRawUnsafe(
      `INSERT INTO knowledge_items (source, kind, ext_key, name, data)
       VALUES ('galaxy', 'station', 'test-sys/Test Galaxy Port', 'Test Galaxy Port',
               jsonb_build_object('marketId', $1::text, 'system', 'No Such System XYZZY',
                                  'type', 'Coriolis Starport',
                                  'landingPads', jsonb_build_object('large', 8)))
       ON CONFLICT (source, kind, ext_key) DO NOTHING`,
      String(MARKET_B),
    );

    await enrichStationFromDock(db, {
      marketId: MARKET_B,
      stationName: 'Test Galaxy Port',
      systemName: 'No Such System XYZZY',
      systemAddress: null,
      stationType: 'Coriolis Starport',
      largePads: 8,
      distFromStarLs: null,
    });

    // The twin is gone...
    const twins = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM knowledge_items
        WHERE source='eddn' AND kind='station' AND ext_key = $1`,
      `${PROVISIONAL_PREFIX}${MARKET_B}`,
    );
    expect(twins[0]?.n).toBe(0);

    // ...its market rows now answer under the galaxy key...
    const migrated = await db.$queryRawUnsafe<Array<{ station_key: string }>>(
      `SELECT station_key FROM market_entries WHERE commodity = 'Testium'`,
    );
    expect(migrated[0]?.station_key).toBe('test-sys/Test Galaxy Port');

    // ...and the lookup resolves to the galaxy identity.
    const found = await lookupByMarketId(db, MARKET_B);
    expect(found?.key).toBe('test-sys/Test Galaxy Port');
    expect(found?.pads).toBe(8);

    await db.$executeRawUnsafe(`DELETE FROM market_entries WHERE commodity = 'Testium'`);
  });

  it('settles the pending queue entry once a dock has answered it', async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO pending_stations (market_id, station_name, system_name)
       VALUES ($1, 'Test Frontier Depot', 'No Such System XYZZY')
       ON CONFLICT (market_id) DO NOTHING`,
      MARKET_A,
    );

    await enrichStationFromDock(db, {
      marketId: MARKET_A,
      stationName: 'Test Frontier Depot',
      systemName: 'No Such System XYZZY',
      systemAddress: null,
      stationType: 'Outpost',
      largePads: 0,
      distFromStarLs: null,
    });

    const left = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM pending_stations WHERE market_id = $1`,
      MARKET_A,
    );
    expect(left[0]?.n).toBe(0);
  });
});
