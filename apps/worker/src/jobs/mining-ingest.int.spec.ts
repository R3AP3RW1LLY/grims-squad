import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ingestMining } from './mining-ingest.js';

/**
 * The mining ingest actually run, against real Postgres.
 *
 * ★ THE SAME REASONING AS leaderboards.int.spec.ts ★
 *
 * Every write in this job is hand-written SQL: an as-of join over `telemetry_events`, an INSERT ..
 * RETURNING, a GREATEST/COALESCE counter roll, and an ON CONFLICT ledger write. None of it
 * typechecks. A wrong column name, a grouping mistake or a type Postgres refuses to cast would all
 * ship green and then fail silently every five minutes inside the daemon's try/catch — which is
 * the worst possible place for it, because the only symptom is a board that never moves.
 *
 * ★ IT ASSERTS ON WHAT IT WROTE, NOT ON WHAT WAS THERE ★
 *
 * The job runs against whatever history the box has. So the test seeds its OWN member and its own
 * events, runs the real job, and asserts only about rows carrying its own ids — then removes them.
 * Asserting on squadron totals would make this fail for reasons that are not defects.
 */

const db = new PrismaClient();

/** A member nobody has, so the seeded events cannot collide with a real commander's history. */
const TEST_TAG = 'mining-ingest-int-spec';

async function seedMember(): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name)
     VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    TEST_TAG,
  );
  // Safe: RETURNING on an upsert that did not throw.
  return (row as { id: string }).id;
}

/**
 * Telemetry cannot exist without the device that sent it — `telemetry_events.device_token_id` is
 * NOT NULL, which is the schema stating that every event is attributable to a specific enrolled
 * companion install. Seeding one is therefore part of seeding a member, not an extra step.
 */
async function seedDevice(userId: string): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO device_tokens (user_id, label, token_hash)
     VALUES ($1::uuid, $2, $2)
     RETURNING id`,
    userId,
    TEST_TAG,
  );
  return (row as { id: string }).id;
}

async function cleanUp(userId: string): Promise<void> {
  // prospected_rocks and mining_sessions cascade from users; the ledger and telemetry do not.
  await db.$executeRawUnsafe(`DELETE FROM leaderboard_events WHERE user_id = $1::uuid`, userId);
  await db.$executeRawUnsafe(`DELETE FROM telemetry_events WHERE user_id = $1::uuid`, userId);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);
}

/**
 * Rewind both cursors so the seeded events are in range.
 *
 * The job is a forward fold behind a cursor, and on a box that has already ingested, the cursor is
 * past anything this test could insert. Rewinding is also the exact mechanism the backfill uses,
 * so this doubles as proof that a rewound cursor re-reads history without double-scoring it.
 */
async function rewindCursors(before: bigint): Promise<void> {
  for (const key of ['mining-prospected-rocks', 'mining-refined-tonnes']) {
    await db.$executeRawUnsafe(
      `INSERT INTO worker_cursors (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      key,
      String(before),
    );
  }
}

describe('the mining ingest, against Postgres', () => {
  it(
    'folds rocks into a session, scores refined tonnes, and scores them exactly once',
    async () => {
      const userId = await seedMember();
      const deviceId = await seedDevice(userId);
      const at = new Date('2026-08-06T20:00:00Z');
      const key = (suffix: string): string => `${TEST_TAG}-${suffix}`;

      try {
        const [highWater] = await db.$queryRawUnsafe<Array<{ id: bigint | null }>>(
          `SELECT max(id) AS id FROM telemetry_events`,
        );
        const before = (highWater as { id: bigint | null }).id ?? 0n;

        // Where the member is: dropped out of supercruise at a ring.
        await db.$executeRawUnsafe(
          `INSERT INTO telemetry_events (user_id, device_token_id, category, event_type, event_key, occurred_at, payload)
           VALUES ($1::uuid, $5::uuid, 'location', 'SupercruiseExit', $2, $3, $4::jsonb)`,
          userId,
          key('place'),
          new Date(at.getTime() - 60_000),
          JSON.stringify({ StarSystem: 'Hyades Sector DB-X d1-112', Body: 'A 2 A Ring' }),
          deviceId,
        );

        // Two rocks: one worth shooting, one not.
        await db.$executeRawUnsafe(
          `INSERT INTO telemetry_events (user_id, device_token_id, category, event_type, event_key, occurred_at, payload)
           VALUES ($1::uuid, $8::uuid, 'mining', 'ProspectedAsteroid', $2, $3, $4::jsonb),
                  ($1::uuid, $8::uuid, 'mining', 'ProspectedAsteroid', $5, $6, $7::jsonb)`,
          userId,
          key('rock-1'),
          at,
          JSON.stringify({
            Materials: [
              { Name: 'painite', Name_Localised: 'Painite', Proportion: 38.2 },
              { Name: 'bertrandite', Proportion: 4.1 },
            ],
            Content_Localised: 'High',
          }),
          key('rock-2'),
          new Date(at.getTime() + 120_000),
          JSON.stringify({ Materials: [{ Name: 'bauxite', Proportion: 2.5 }] }),
          deviceId,
        );

        // Two tonnes out of the refinery, in the same stretch.
        await db.$executeRawUnsafe(
          `INSERT INTO telemetry_events (user_id, device_token_id, category, event_type, event_key, occurred_at, payload)
           VALUES ($1::uuid, $8::uuid, 'mining', 'MiningRefined', $2, $3, $4::jsonb),
                  ($1::uuid, $8::uuid, 'mining', 'MiningRefined', $5, $6, $7::jsonb)`,
          userId,
          key('refined-1'),
          new Date(at.getTime() + 180_000),
          JSON.stringify({ Type_Localised: 'Painite' }),
          key('refined-2'),
          new Date(at.getTime() + 240_000),
          JSON.stringify({ Type_Localised: 'Void Opal' }),
          deviceId,
        );

        await rewindCursors(before);
        await ingestMining(db);

        // ---- the rocks landed, in one session, with the ring on them ----
        const rocks = await db.$queryRawUnsafe<
          Array<{ top_material: string; top_percent: number; body_name: string | null; session_id: string }>
        >(`SELECT top_material, top_percent, body_name, session_id FROM prospected_rocks WHERE user_id = $1::uuid ORDER BY at`, userId);

        expect(rocks, 'the barren rock should be dropped, the two real ones kept').toHaveLength(2);
        // Sorted richest-first by the shared reader — 38.2% Painite beats 4.1% Bertrandite.
        expect(rocks[0]?.top_material).toBe('Painite');
        expect(rocks[0]?.body_name, 'the as-of join did not find the ring').toBe('A 2 A Ring');
        expect(
          new Set(rocks.map((r) => r.session_id)).size,
          'rocks two minutes apart were split across sessions',
        ).toBe(1);

        // ---- the session counters rolled ----
        const [session] = await db.$queryRawUnsafe<
          Array<{ rocks_prospected: number; rocks_hit: number; tonnes_refined: number; points: number }>
        >(`SELECT rocks_prospected, rocks_hit, tonnes_refined, points FROM mining_sessions WHERE user_id = $1::uuid`, userId);

        expect(session?.rocks_prospected).toBe(2);
        // 38.2% clears the default bar; 2.5% Bauxite does not.
        expect(session?.rocks_hit).toBe(1);
        expect(session?.tonnes_refined).toBe(2);
        // Painite ×4 + Void Opal ×8.
        expect(session?.points).toBe(12);

        // ---- the ledger got the points, on the mining board ----
        const [ledger] = await db.$queryRawUnsafe<Array<{ n: number; total: number }>>(
          `SELECT count(*)::int AS n, coalesce(sum(points), 0)::int AS total
             FROM leaderboard_events WHERE user_id = $1::uuid AND board = 'mining'`,
          userId,
        );
        expect(ledger?.n).toBe(2);
        expect(ledger?.total).toBe(12);

        /*
         * ★ THE REPLAY, WHICH IS ALSO THE BACKFILL ★
         *
         * Rewinding the cursor and running again is exactly what banking eleven thousand rows of
         * existing history does. If the ledger or the session counters moved, the backfill would
         * silently double every miner's score — so this is the assertion the whole design exists
         * to make safe.
         */
        await rewindCursors(before);
        await ingestMining(db);

        const [again] = await db.$queryRawUnsafe<Array<{ n: number; total: number }>>(
          `SELECT count(*)::int AS n, coalesce(sum(points), 0)::int AS total
             FROM leaderboard_events WHERE user_id = $1::uuid AND board = 'mining'`,
          userId,
        );
        expect(again?.n, 'a replayed batch scored the same tonne twice').toBe(2);
        expect(again?.total).toBe(12);

        const [rolled] = await db.$queryRawUnsafe<Array<{ tonnes_refined: number; points: number }>>(
          `SELECT tonnes_refined, points FROM mining_sessions WHERE user_id = $1::uuid`,
          userId,
        );
        expect(rolled?.tonnes_refined, 'the session tonnage drifted on replay').toBe(2);
        expect(rolled?.points, 'the session points drifted on replay').toBe(12);
      } finally {
        await cleanUp(userId);
        await db.$disconnect();
      }
    },
    60_000,
  );
});
