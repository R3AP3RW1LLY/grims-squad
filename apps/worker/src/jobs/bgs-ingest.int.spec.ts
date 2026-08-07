import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ingestBgs } from './bgs-ingest.js';

/**
 * The BGS ingest run against real Postgres.
 *
 * ★ THE SAME REASONING AS mining-ingest.int.spec.ts ★
 *
 * Every write here is hand-written SQL against two enums (`BgsActivityType`, `DataSource`), a
 * foreign key into a table that is filled lazily, and a partial unique index. None of that
 * typechecks. It would ship green and then fail every five minutes inside the daemon's try/catch,
 * where the only symptom is a leaderboard that never moves.
 *
 * ★ WHAT IS ACTUALLY AT RISK ★
 *
 * Double-paying on replay. This job exists to be re-run — the 2,844 events of history are ingested
 * by rewinding the cursor, which is the same code path as a crash-and-restart. If the ledger write
 * is not truly idempotent, the first backfill inflates the board and there is no way to tell which
 * points were real.
 */

const db = new PrismaClient();
const TAG = 'bgs-ingest-int-spec';
const OURS = `${TAG} Holdings`;
const RIVAL = `${TAG} Rivals`;
const UNWATCHED = `${TAG} Nobody Asked`;

async function seedMember(): Promise<{ userId: string; deviceId: string }> {
  const [u] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    TAG,
  );
  const userId = (u as { id: string }).id;

  const [d] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO device_tokens (user_id, label, token_hash) VALUES ($1::uuid, $2, $2) RETURNING id`,
    userId,
    TAG,
  );
  return { userId, deviceId: (d as { id: string }).id };
}

/**
 * A galaxy row for a system this spec owns, so `ensureSystem` runs its lazy-create for real.
 *
 * ★ SEEDED, NOT BORROWED — CAUGHT BY CI ★
 *
 * This used to pick any real system out of `knowledge_items` and fail loudly when it found none.
 * That reads as rigorous and is wrong: a fresh CI database has no galaxy dump and never will, so
 * the spec could not pass there by construction. It went red on the first run against a clean box.
 *
 * Seeding its own row keeps the interesting half of `ensureSystem` under test — the
 * `cube_ll_coord` extraction and the `ext_key` match, which are exactly the two things that fail
 * at runtime and nowhere else — while depending on nothing but the schema.
 */
const TEST_ADDRESS = '900000000000001';

async function seedGalaxySystem(): Promise<{ address: string; preexisting: boolean }> {
  const [have] = await db.$queryRawUnsafe<Array<{ address: bigint }>>(
    `SELECT address FROM systems WHERE address = $1::bigint`,
    TEST_ADDRESS,
  );

  await db.$executeRawUnsafe(
    `INSERT INTO knowledge_items (source, kind, ext_key, name, data, coords, text)
     VALUES ('galaxy', 'system', $1, $2, '{}'::jsonb, cube(array[1.0, 2.0, 3.0]), $2)
     ON CONFLICT (source, kind, ext_key) DO UPDATE SET coords = EXCLUDED.coords`,
    TEST_ADDRESS,
    `${TAG} System`,
  );

  return { address: TEST_ADDRESS, preexisting: have !== undefined };
}

/**
 * Put the system in `systems` the way the BGS service does when an officer sets an order.
 *
 * `bgs_orders.system_address` is a foreign key, so an order cannot exist for a system we have never
 * written down — which means in production the row is always there BEFORE any order names it. A
 * test that seeds orders against a bare address is testing a state the application cannot reach.
 */
async function ensureSystemRow(address: string): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO systems (address, name, x, y, z, observed_at)
     SELECT $1::bigint, k.name,
            cube_ll_coord(k.coords, 1), cube_ll_coord(k.coords, 2), cube_ll_coord(k.coords, 3),
            now()
       FROM knowledge_items k
      WHERE k.kind = 'system' AND k.ext_key = $1 AND k.coords IS NOT NULL
      LIMIT 1
     ON CONFLICT (address) DO NOTHING`,
    address,
  );
}

async function seedFaction(name: string, ours: boolean): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO tracked_factions (name, is_ours) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET is_ours = EXCLUDED.is_ours RETURNING id`,
    name,
    ours,
  );
  return (row as { id: string }).id;
}

async function seedMission(
  userId: string,
  deviceId: string,
  key: string,
  effects: unknown,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO telemetry_events
       (user_id, device_token_id, category, event_type, occurred_at, payload, event_key)
     VALUES ($1::uuid, $2::uuid, 'bgs'::"TelemetryCategory", 'MissionCompleted', now(), $3::jsonb, $4)
     ON CONFLICT DO NOTHING`,
    userId,
    deviceId,
    JSON.stringify({ FactionEffects: effects }),
    key,
  );
}

/** Put the cursor behind the seeded rows — the same mechanism the backfill uses. */
async function rewind(before: bigint): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO worker_cursors (key, value, updated_at) VALUES ('bgs-mission-influence', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    String(before > 0n ? before - 1n : 0n),
  );
}

async function cleanUp(userId: string, systemDrop: string | null): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM leaderboard_events WHERE user_id = $1::uuid`, userId);
  await db.$executeRawUnsafe(`DELETE FROM bgs_activity_reports WHERE user_id = $1::uuid`, userId);
  await db.$executeRawUnsafe(`DELETE FROM telemetry_events WHERE user_id = $1::uuid`, userId);
  await db.$executeRawUnsafe(`DELETE FROM device_tokens WHERE user_id = $1::uuid`, userId);
  /*
   * Orders and factions BEFORE the member. `bgs_orders.set_by_id` points at the officer who set it,
   * so removing the member first is refused — and the refusal happens in a `finally`, which turns a
   * clean-up ordering slip into a failure that masks whatever the test actually found.
   */
  await db.$executeRawUnsafe(`DELETE FROM bgs_orders WHERE guidance_md = $1`, TAG);
  await db.$executeRawUnsafe(`DELETE FROM tracked_factions WHERE name LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);
  if (systemDrop !== null) {
    await db.$executeRawUnsafe(`DELETE FROM systems WHERE address = $1::bigint`, systemDrop);
  }
  // The seeded galaxy row too — this spec created it, so this spec removes it.
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_items WHERE kind = 'system' AND ext_key = $1`,
    TEST_ADDRESS,
  );
}

describe('the BGS ingest, against Postgres', () => {
  it(
    'scores what the officers ordered, records what they did not, and never pays twice',
    async () => {
      const place = await seedGalaxySystem();

      const { userId, deviceId } = await seedMember();
      const ourId = await seedFaction(OURS, true);
      const rivalId = await seedFaction(RIVAL, false);
      // UNWATCHED is deliberately NOT seeded. Putting it in `tracked_factions` is what "watched"
      // means, so seeding it would quietly test the opposite of what this case is named for.

      try {
        await ensureSystemRow(place.address);

        await db.$executeRawUnsafe(
          `INSERT INTO bgs_orders (system_address, faction_id, directive, priority, guidance_md, set_by_id)
           VALUES ($1::bigint, $2::uuid, 'push'::"BgsDirective", 1, $3, $4::uuid)`,
          place.address,
          ourId,
          TAG,
          userId,
        );
        await db.$executeRawUnsafe(
          `INSERT INTO bgs_orders (system_address, faction_id, directive, priority, guidance_md, set_by_id)
           VALUES ($1::bigint, $2::uuid, 'suppress'::"BgsDirective", 2, $3, $4::uuid)`,
          place.address,
          rivalId,
          TAG,
          userId,
        );

        const [seq] = await db.$queryRawUnsafe<Array<{ next: bigint }>>(
          `SELECT COALESCE(max(id), 0) + 1 AS next FROM telemetry_events`,
        );
        const from = (seq as { next: bigint }).next;

        /*
         * One realistic mission: handed in for our faction, which pushed a rival the other way, and
         * incidentally moved a third faction nobody is watching. That is what a real
         * `MissionCompleted` looks like — reading only the first effect is the shape of the mistake.
         */
        await seedMission(userId, deviceId, `${TAG}-1`, [
          { Faction: OURS, Influence: [{ SystemAddress: place.address, Influence: '++' }] },
          { Faction: RIVAL, Influence: [{ SystemAddress: place.address, Influence: '-' }] },
          { Faction: UNWATCHED, Influence: [{ SystemAddress: place.address, Influence: '+++' }] },
        ]);

        await rewind(from);
        const first = await ingestBgs(db);

        expect(first.effects, 'the watched factions were not both recorded').toBe(2);

        const paid = await db.$queryRawUnsafe<Array<{ points: number }>>(
          `SELECT points FROM leaderboard_events WHERE user_id = $1::uuid AND board = 'bgs'`,
          userId,
        );

        /*
         * ★ PUSH PAYS, AND SUPPRESS PAYS FOR THE OPPOSITE SIGN ★
         *
         * Two pips gained for a faction we are pushing is +20. One pip LOST by a faction we were
         * told to suppress is the work that was asked for, so it scores +10 rather than -10 —
         * treating every stance's pips alike would pay members for strengthening the exact faction
         * they were sent to hold back.
         */
        expect(paid.map((p) => p.points).sort((a, b) => a - b)).toEqual([10, 20]);

        /*
         * The unwatched faction is nowhere. Counted as a total rather than searched for by name —
         * the report carries a faction ID, and a faction nobody tracks has no ID to search for, so
         * "two reports, no more" is the only honest way to state it.
         */
        const total = await db.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM bgs_activity_reports WHERE user_id = $1::uuid`,
          userId,
        );
        expect((total[0] as { n: number }).n, 'a faction nobody tracks was recorded').toBe(2);

        /*
         * ★ THE REPLAY ★
         *
         * The backfill IS a rewind, so this is not a hypothetical — it is the first thing that will
         * happen in production. Same events, same cursor position, and the board must not move.
         */
        await rewind(from);
        const second = await ingestBgs(db);

        expect(second.scored, 'a replayed mission was paid a second time').toBe(0);

        const after = await db.$queryRawUnsafe<Array<{ n: number; total: number }>>(
          `SELECT count(*)::int AS n, COALESCE(sum(points), 0)::int AS total
             FROM leaderboard_events WHERE user_id = $1::uuid AND board = 'bgs'`,
          userId,
        );
        expect((after[0] as { n: number }).n).toBe(2);
        expect((after[0] as { total: number }).total).toBe(30);
      } finally {
        await cleanUp(userId, place.preexisting ? null : place.address);
      }
    },
    120_000,
  );

  it(
    'records a watched faction with no standing order, and pays nothing for it',
    async () => {
      const place = await seedGalaxySystem();

      const { userId, deviceId } = await seedMember();
      const ourId = await seedFaction(OURS, true);

      try {
        const [seq] = await db.$queryRawUnsafe<Array<{ next: bigint }>>(
          `SELECT COALESCE(max(id), 0) + 1 AS next FROM telemetry_events`,
        );

        await seedMission(userId, deviceId, `${TAG}-noorder`, [
          { Faction: OURS, Influence: [{ SystemAddress: place.address, Influence: '+' }] },
        ]);

        await rewind((seq as { next: bigint }).next);
        const out = await ingestBgs(db);

        /*
         * The history is kept even though it scores nothing. It is what the charts read and what an
         * officer looks at when deciding what the order SHOULD be — a faction we back but have not
         * issued an order about is exactly the case worth seeing.
         */
        expect(out.effects, 'the contribution was not recorded').toBe(1);
        expect(out.points, 'a faction with no order was paid').toBe(0);

        const reports = await db.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM bgs_activity_reports
            WHERE user_id = $1::uuid AND faction_id = $2::uuid`,
          userId,
          ourId,
        );
        expect((reports[0] as { n: number }).n).toBe(1);

        const points = await db.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM leaderboard_events WHERE user_id = $1::uuid`,
          userId,
        );
        expect((points[0] as { n: number }).n).toBe(0);
      } finally {
        await cleanUp(userId, place.preexisting ? null : place.address);
        await db.$disconnect();
      }
    },
    120_000,
  );
});
