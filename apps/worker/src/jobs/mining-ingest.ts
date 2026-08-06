import type { PrismaClient } from '@grims/db';
import {
  DEFAULT_PROSPECT_THRESHOLD,
  continuesSession,
  materialWeight,
  readRock,
} from '@grims/shared';

/**
 * Mining ingest — rocks into sessions, refined tonnes into points.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... gamified leaderboard aswell that works the same way as our
 * existing leaderboards ... the leaderboard should be on refined materials etc."
 *
 * ★ TWO STREAMS, ONE SESSION ★
 *
 * `ProspectedAsteroid` says what a member looked at; `MiningRefined` says what they actually got.
 * Both are folded into the same `mining_sessions` row, because the only interesting mining numbers
 * are ratios between them — tonnes per hour, and the share of rocks worth shooting. Either stream
 * alone is a number with nothing to divide by.
 *
 * ★ SCORED ON REFINING, NOT ON SELLING ★
 *
 * `MiningRefined` fires when the refinery completes a tonne: the moment the work happened, in the
 * ring, by the member who did it. Selling is a different skill with its own board, and scoring the
 * sale would pay twice for one tonne and credit whoever happened to be flying the hauler.
 *
 * ★ REPLAY-SAFE BY THE SAME RULES AS EVERY OTHER SCORER ★
 *
 * Cursors in `worker_cursors`, a unique `(board, source_key)` on the ledger, and `ON CONFLICT DO
 * NOTHING` everywhere. A crashed run, a replayed batch or a rewound cursor scores nothing twice —
 * which is also what makes the backfill over existing history just a rewound cursor rather than a
 * separate one-shot script that would have to be got right first time.
 */

const CURSORS = {
  rocks: 'mining-prospected-rocks',
  refined: 'mining-refined-tonnes',
} as const;

/*
 * Smaller than the leaderboard scorers' 2,000. `ProspectedAsteroid` is by a wide margin the
 * highest-volume event on the platform — several hundred an hour per active miner — and each row
 * here costs a session lookup and an insert rather than the scorers' single insert.
 */
const BATCH = 500;

/**
 * How far back to look for the location a rock was shot at.
 *
 * A member drops into a ring and then prospects for an hour without another location event, so the
 * window has to be generous. Six hours is longer than any single session the gap rule allows, which
 * means the lookup can never be the reason a rock has no ring on it.
 */
const LOCATION_LOOKBACK_HOURS = 6;

export interface MiningIngestReport {
  readonly rocks: number;
  readonly tonnes: number;
  readonly points: number;
  readonly sessions: number;
}

interface Place {
  readonly at: Date;
  readonly system: string | null;
  readonly body: string | null;
}

/** A session held open across a batch, so a night of rocks costs one lookup rather than hundreds. */
interface OpenSession {
  id: string;
  lastAt: Date;
  system: string | null;
  body: string | null;
}

async function cursorOf(db: PrismaClient, key: string): Promise<bigint> {
  const [row] = await db.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT value FROM worker_cursors WHERE key = $1`,
    key,
  );
  return row === undefined ? 0n : BigInt(row.value);
}

async function saveCursor(db: PrismaClient, key: string, value: bigint): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO worker_cursors (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    key,
    String(value),
  );
}

/**
 * Where a member was at a given moment.
 *
 * ★ AN AS-OF JOIN, IN MEMORY, ONCE PER BATCH ★
 *
 * Resolving this per rock would be a query per rock — hundreds per member per hour, against the
 * largest table on the platform. Resolving it once per SESSION would be cheap but wrong: a member
 * who moves to a second ring mid-session would have every rock filed under the first one, which is
 * precisely the answer the ring intelligence exists to get right.
 *
 * So the whole window is fetched once and walked in memory. `Location` and `SupercruiseExit` carry
 * the body — and dropping out of supercruise at a ring is exactly the event that fires when mining
 * begins. `FSDJump` carries only the system, which correctly CLEARS the body: you are no longer at
 * the ring you left.
 */
async function placesFor(
  db: PrismaClient,
  userIds: readonly string[],
  from: Date,
  to: Date,
): Promise<Map<string, Place[]>> {
  const rows = await db.$queryRawUnsafe<
    Array<{ user_id: string; occurred_at: Date; payload: Record<string, unknown> }>
  >(
    `SELECT user_id, occurred_at, payload
       FROM telemetry_events
      WHERE user_id = ANY($1::uuid[])
        AND event_type IN ('Location', 'SupercruiseExit', 'FSDJump')
        AND occurred_at BETWEEN $2::timestamptz - interval '${LOCATION_LOOKBACK_HOURS} hours' AND $3::timestamptz
      ORDER BY user_id, occurred_at`,
    userIds,
    from,
    to,
  );

  const byUser = new Map<string, Place[]>();
  for (const r of rows) {
    const p = r.payload;
    const system = typeof p['StarSystem'] === 'string' ? p['StarSystem'] : null;
    const body = typeof p['Body'] === 'string' ? p['Body'] : null;

    const list = byUser.get(r.user_id) ?? [];
    list.push({ at: r.occurred_at, system, body });
    byUser.set(r.user_id, list);
  }
  return byUser;
}

/**
 * The last known place at or before a moment.
 *
 * Linear rather than a binary search on purpose: the list is one member's location events across a
 * few hours, which is tens of rows. A binary search here would be more code to get wrong for no
 * measurable gain.
 */
function placeAt(places: readonly Place[] | undefined, at: Date): Place | null {
  if (places === undefined) return null;

  let found: Place | null = null;
  for (const p of places) {
    if (p.at.getTime() > at.getTime()) break;
    found = p;
  }
  return found;
}

/**
 * Find the session this moment belongs to, opening one if it does not continue an existing one.
 *
 * The cache is the point: within a batch a member's rocks are consecutive, so the second rock
 * onward costs nothing. Across batches the lookup re-reads the member's newest session and the gap
 * rule decides again — which is what makes a crashed run resume into the same session rather than
 * splitting the evening in half.
 */
async function sessionFor(
  db: PrismaClient,
  cache: Map<string, OpenSession>,
  opened: { count: number },
  userId: string,
  at: Date,
  place: Place | null,
): Promise<OpenSession> {
  const held = cache.get(userId);
  if (held !== undefined && continuesSession(held.lastAt, at)) {
    held.lastAt = at;
    return held;
  }

  const [row] = await db.$queryRawUnsafe<
    Array<{ id: string; ended_at: Date | null; system_name: string | null; body_name: string | null }>
  >(
    `SELECT id, ended_at, system_name, body_name
       FROM mining_sessions
      WHERE user_id = $1::uuid
      ORDER BY started_at DESC
      LIMIT 1`,
    userId,
  );

  if (row !== undefined && row.ended_at !== null && continuesSession(row.ended_at, at)) {
    const resumed: OpenSession = {
      id: row.id,
      lastAt: at,
      system: row.system_name,
      body: row.body_name,
    };
    cache.set(userId, resumed);
    return resumed;
  }

  const [created] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO mining_sessions (user_id, started_at, ended_at, system_name, body_name, ring_name)
     VALUES ($1::uuid, $2, $2, $3, $4, $4)
     RETURNING id`,
    userId,
    at,
    place?.system ?? null,
    /*
     * The ring IS the body, in Frontier's own naming: "Hyades Sector DB-X d1-112 A 2 A Ring". Both
     * columns carry it so a later query can group by ring without having to know that.
     */
    place?.body ?? null,
  );

  opened.count += 1;
  const fresh: OpenSession = {
    // Safe: RETURNING on an INSERT that did not throw.
    id: (created as { id: string }).id,
    lastAt: at,
    system: place?.system ?? null,
    body: place?.body ?? null,
  };
  cache.set(userId, fresh);
  return fresh;
}

/** Push the session's clock forward and roll the per-session counters. */
async function touchSession(
  db: PrismaClient,
  id: string,
  at: Date,
  add: { rocks?: number; hits?: number; tonnes?: number; points?: number },
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE mining_sessions
        SET ended_at = GREATEST(COALESCE(ended_at, $2::timestamptz), $2::timestamptz),
            rocks_prospected = rocks_prospected + $3,
            rocks_hit        = rocks_hit + $4,
            tonnes_refined   = tonnes_refined + $5,
            points           = points + $6
      WHERE id = $1::uuid`,
    id,
    at,
    add.rocks ?? 0,
    add.hits ?? 0,
    add.tonnes ?? 0,
    add.points ?? 0,
  );
}

/* ──────────────────────────────────────────────────────────────── the rocks */

async function ingestRocks(
  db: PrismaClient,
  opened: { count: number },
): Promise<number> {
  let written = 0;
  let cursor = await cursorOf(db, CURSORS.rocks);
  const cache = new Map<string, OpenSession>();

  for (;;) {
    const rows = await db.$queryRawUnsafe<
      Array<{ id: bigint; user_id: string; event_key: string; occurred_at: Date; payload: unknown }>
    >(
      `SELECT id, user_id, event_key, occurred_at, payload
         FROM telemetry_events
        WHERE event_type = 'ProspectedAsteroid' AND id > $1::bigint
        ORDER BY id
        LIMIT ${BATCH}`,
      String(cursor),
    );
    if (rows.length === 0) break;

    const users = [...new Set(rows.map((r) => r.user_id))];
    const times = rows.map((r) => r.occurred_at.getTime());
    const places = await placesFor(
      db,
      users,
      new Date(Math.min(...times)),
      new Date(Math.max(...times)),
    );

    for (const r of rows) {
      cursor = r.id;

      const rock = readRock(r.payload);
      /*
       * A barren rock is dropped rather than filed with a blank material. It is genuinely
       * information — the member learned this rock was worthless — but it is information about a
       * ring, and a row whose top material is an empty string would poison every "what is this ring
       * running" query it appears in.
       */
      if (rock === null) continue;

      const place = placeAt(places.get(r.user_id), r.occurred_at);
      const session = await sessionFor(db, cache, opened, r.user_id, r.occurred_at, place);

      const inserted = await db.$executeRawUnsafe(
        `INSERT INTO prospected_rocks
           (session_id, user_id, at, system_name, body_name, top_material, top_percent, content, motherlode)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
        session.id,
        r.user_id,
        r.occurred_at,
        place?.system ?? session.system,
        place?.body ?? session.body,
        rock.top.name,
        rock.top.percent,
        rock.content,
        rock.motherlode,
      );

      /*
       * ★ THE SQUADRON'S YARDSTICK, NOT THE MEMBER'S ★
       *
       * "Worth shooting" here uses the DEFAULT threshold, deliberately — not the member's own
       * setting. Their percentages are a personal preference stored on their own machine, and
       * scoring against them would make hit rate mean something different for every member and be
       * improvable by lowering a slider. One yardstick keeps the sessions comparable.
       */
      const hit = rock.top.percent >= DEFAULT_PROSPECT_THRESHOLD ? 1 : 0;
      await touchSession(db, session.id, r.occurred_at, { rocks: 1, hits: hit });

      written += inserted;
    }

    await saveCursor(db, CURSORS.rocks, cursor);
    if (rows.length < BATCH) break;
  }

  return written;
}

/* ────────────────────────────────────────────────────────── the refined tonnes */

async function scoreRefined(
  db: PrismaClient,
  opened: { count: number },
): Promise<{ tonnes: number; points: number }> {
  let tonnes = 0;
  let points = 0;
  let cursor = await cursorOf(db, CURSORS.refined);
  const cache = new Map<string, OpenSession>();

  for (;;) {
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: bigint;
        user_id: string;
        event_key: string;
        occurred_at: Date;
        payload: Record<string, unknown>;
      }>
    >(
      `SELECT id, user_id, event_key, occurred_at, payload
         FROM telemetry_events
        WHERE event_type = 'MiningRefined' AND id > $1::bigint
        ORDER BY id
        LIMIT ${BATCH}`,
      String(cursor),
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      cursor = r.id;

      const p = r.payload;
      const name =
        typeof p['Type_Localised'] === 'string' && p['Type_Localised'].trim() !== ''
          ? p['Type_Localised'].trim()
          : typeof p['Type'] === 'string' && p['Type'].trim() !== ''
            ? p['Type'].trim()
            : null;
      // An event that does not say what was refined cannot be scored, and inventing a name for it
      // would put an unlabelled material on the member's own history page.
      if (name === null) continue;

      /*
       * ★ ONE EVENT IS ONE TONNE ★
       *
       * `MiningRefined` carries no quantity — it fires once per completed tonne. Reading a count
       * off it would be inventing one, and the companion's refinery fold counts it the same way for
       * the same reason. The number a member watches all evening has to be the number that lands.
       */
      const value = materialWeight(name);

      const wrote = await db.$executeRawUnsafe(
        `INSERT INTO leaderboard_events (user_id, board, points, source_key, meta, occurred_at)
         VALUES ($1::uuid, 'mining', $2, $3, $4::jsonb, $5)
         ON CONFLICT (board, source_key) DO NOTHING`,
        r.user_id,
        value,
        r.event_key,
        JSON.stringify({ material: name, tonnes: 1 }),
        r.occurred_at,
      );

      /*
       * The session counters follow the LEDGER, not the loop. A replayed batch writes no
       * leaderboard row — `ON CONFLICT DO NOTHING` returns zero — and must not bump the session's
       * tonnage either, or a member's history page would drift upward every time the cursor was
       * rewound while the board stayed correct. Two numbers for one fact, disagreeing.
       */
      if (wrote === 0) continue;

      const session = await sessionFor(db, cache, opened, r.user_id, r.occurred_at, null);
      await touchSession(db, session.id, r.occurred_at, { tonnes: 1, points: value });

      tonnes += 1;
      points += value;
    }

    await saveCursor(db, CURSORS.refined, cursor);
    if (rows.length < BATCH) break;
  }

  return { tonnes, points };
}

/**
 * Fold both mining streams forward.
 *
 * Rocks first, so that a session already exists (with its ring on it) by the time the tonnes that
 * came out of those rocks are scored. The other order still works — the gap rule would open the
 * session from the refining event — but it would open it with no location, since `MiningRefined`
 * says nothing about where you are.
 */
export async function ingestMining(db: PrismaClient): Promise<MiningIngestReport> {
  const opened = { count: 0 };
  const rocks = await ingestRocks(db, opened);
  const { tonnes, points } = await scoreRefined(db, opened);
  return { rocks, tonnes, points, sessions: opened.count };
}
