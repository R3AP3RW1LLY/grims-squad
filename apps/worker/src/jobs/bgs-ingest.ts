import type { PrismaClient } from '@grims/db';
import { readFactionEffects, scoreContribution, type BgsStance } from '@grims/shared';

/**
 * Missions into influence, and influence into points — but only where the officers asked.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "create a BGS leaderboard, and allow the officers to choose what factions we want to be running
 * missions for etc, give instructions to the squad members etc."
 *
 * ★ IT LAUNCHES WITH HISTORY ★
 *
 * Production holds 2,844 `MissionCompleted` events carrying full `FactionEffects` — faction,
 * per-system influence, trend — going back weeks. The cursor starts at zero, so the first run banks
 * every one of them. The backfill is not a separate script; it is this job, run once.
 *
 * ★ NOTHING SCORES WITHOUT AN ORDER ★
 *
 * A mission for a faction nobody asked about is recorded and paid nothing. That single rule is what
 * makes the board an instrument of direction rather than a record of who played most — officers
 * change what the squadron is rewarded for by editing a list, not by asking twice in Discord.
 */

const CURSOR = 'bgs-mission-influence';
const BATCH = 500;

export interface BgsReport {
  readonly effects: number;
  readonly scored: number;
  readonly points: number;
}

async function cursorOf(db: PrismaClient): Promise<bigint> {
  const [row] = await db.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT value FROM worker_cursors WHERE key = $1`,
    CURSOR,
  );
  return row === undefined ? 0n : BigInt(row.value);
}

/**
 * Make sure a system row exists for this address.
 *
 * `bgs_activity_reports.system_address` is a foreign key to `systems`, which is filled lazily — see
 * the same reasoning in the BGS service. The galaxy lives in `knowledge_items`, and 216,000 rows
 * are not worth copying to satisfy the handful of systems a squadron actually fights in.
 *
 * Returns false when we hold nothing for the address at all, in which case the effect is skipped:
 * a foreign key we cannot satisfy is a row we cannot write, and inventing a placeholder system
 * would put influence against a place that does not exist.
 */
async function ensureSystem(db: PrismaClient, address: string): Promise<boolean> {
  const [have] = await db.$queryRawUnsafe<Array<{ address: bigint }>>(
    `SELECT address FROM systems WHERE address = $1::bigint`,
    address,
  );
  if (have !== undefined) return true;

  const [known] = await db.$queryRawUnsafe<
    Array<{ name: string; x: number; y: number; z: number }>
  >(
    `SELECT name,
            cube_ll_coord(coords, 1) AS x,
            cube_ll_coord(coords, 2) AS y,
            cube_ll_coord(coords, 3) AS z
       FROM knowledge_items
      WHERE kind = 'system' AND ext_key = $1 AND coords IS NOT NULL
      LIMIT 1`,
    address,
  );
  if (known === undefined) return false;

  await db.$executeRawUnsafe(
    `INSERT INTO systems (address, name, x, y, z, observed_at)
     VALUES ($1::bigint, $2, $3, $4, $5, now())
     ON CONFLICT (address) DO NOTHING`,
    address,
    known.name,
    known.x,
    known.y,
    known.z,
  );
  return true;
}

/** Fold every unprocessed mission into influence records and points. */
export async function ingestBgs(db: PrismaClient): Promise<BgsReport> {
  let effects = 0;
  let scored = 0;
  let points = 0;
  let cursor = await cursorOf(db);

  /*
   * The watchlist and the standing orders, read ONCE per run rather than per mission. Both are
   * officer-sized tables — a handful of factions, a handful of orders — and a lookup per effect
   * would be thousands of queries to answer a question that does not change mid-run.
   */
  const watched = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT id, name FROM tracked_factions`,
  );
  const byName = new Map(watched.map((f) => [f.name.trim().toLowerCase(), f.id]));

  const orders = await db.$queryRawUnsafe<
    Array<{ faction_id: string; system_address: string; directive: string }>
  >(
    `SELECT faction_id, system_address::text AS system_address, directive::text AS directive
       FROM bgs_orders
      WHERE active_until IS NULL OR active_until > now()
      ORDER BY priority`,
  );
  const orderFor = new Map(
    orders.map((o) => [`${o.faction_id}:${o.system_address}`, o.directive as BgsStance]),
  );

  for (;;) {
    const rows = await db.$queryRawUnsafe<
      Array<{ id: bigint; user_id: string; event_key: string; occurred_at: Date; payload: unknown }>
    >(
      `SELECT id, user_id, event_key, occurred_at, payload
         FROM telemetry_events
        WHERE event_type = 'MissionCompleted' AND id > $1::bigint
        ORDER BY id
        LIMIT ${BATCH}`,
      String(cursor),
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      cursor = r.id;

      for (const effect of readFactionEffects(r.payload)) {
        const factionId = byName.get(effect.faction.trim().toLowerCase());

        /*
         * A faction nobody asked about. Not recorded at all — `bgs_activity_reports.faction_id`
         * points at `tracked_factions`, so there is nowhere to put it, and the squadron does not
         * want a ledger of every minor faction in the bubble that a member happened to help.
         */
        if (factionId === undefined) continue;

        if (!(await ensureSystem(db, effect.systemAddress))) continue;
        effects += 1;

        const stance = orderFor.get(`${factionId}:${effect.systemAddress}`) ?? null;
        const pay = scoreContribution({
          pips: effect.pips,
          order: stance === null ? null : { faction: effect.faction, stance },
        });

        /*
         * The influence record itself, whether or not it scores. A faction we back but have issued
         * no order about is still worth a history — it is what the charts read, and what an officer
         * looks at when deciding what the order SHOULD be.
         *
         * `(user_id, source_event_id)` is unique, which is what makes this replayable (INV-017).
         */
        const wrote = await db.$executeRawUnsafe(
          `INSERT INTO bgs_activity_reports
             (user_id, system_address, faction_id, activity_type, count, reported_at, source, source_event_id)
           VALUES ($1::uuid, $2::bigint, $3::uuid, 'missions'::"BgsActivityType", $4, $5, 'companion'::"DataSource", $6)
           ON CONFLICT (user_id, source_event_id) DO NOTHING`,
          r.user_id,
          effect.systemAddress,
          factionId,
          effect.pips,
          r.occurred_at,
          // The faction and system ride in the key: one mission moves several factions in several
          // systems, so the event id alone would collapse them into one row.
          `${r.event_key}:${factionId}:${effect.systemAddress}`,
        );

        // Nothing new means a replay. The board must not be paid again for it.
        if (wrote === 0 || pay === 0) continue;

        await db.$executeRawUnsafe(
          `INSERT INTO leaderboard_events (user_id, board, points, source_key, meta, occurred_at)
           VALUES ($1::uuid, 'bgs', $2, $3, $4::jsonb, $5)
           ON CONFLICT (board, source_key) DO NOTHING`,
          r.user_id,
          pay,
          `${r.event_key}:${factionId}:${effect.systemAddress}`,
          JSON.stringify({
            faction: effect.faction,
            pips: effect.pips,
            stance,
          }),
          r.occurred_at,
        );

        scored += 1;
        points += pay;
      }
    }

    await db.$executeRawUnsafe(
      `INSERT INTO worker_cursors (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      CURSOR,
      String(cursor),
    );

    if (rows.length < BATCH) break;
  }

  return { effects, scored, points };
}
