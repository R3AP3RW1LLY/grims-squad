import type { PrismaClient } from '@grims/db';
import {
  COLONY_LINE_CLOSER_BONUS,
  COLONY_PRIORITY_MULTIPLIER,
  TRADE_CREDITS_PER_POINT,
  tiersEarned,
  type LeaderboardKey,
} from '@grims/shared';

/**
 * The scorers and the badge sweep — where deeds become points and points become badges.
 *
 * ★ SQUADRON OWNER, 2026-08-04 ★
 *
 * "gamify the colonization leaderboard, make badges ect the same way were doing it for
 * databounties ... then we also need to make a leaderboard and gamify it for Trade routes" —
 * with the scoring chosen as tonnes×priority(+line-closer bonus) for colony and REALIZED profit
 * for trade.
 *
 * ★ EVERY SCORER IS A REPLAYABLE FOLD OVER AN APPEND-ONLY SOURCE ★
 *
 * Colony reads colony_contributions (append-only by design), trade reads telemetry_events
 * (append-only, purged at 30 days — which is why the scorer runs every five minutes and banks
 * points into leaderboard_events long before the purge can reach them). Both advance a cursor in
 * worker_cursors and both write through a (board, source_key) unique index, so a crashed run, a
 * replayed batch or a rewound cursor scores nothing twice.
 *
 * ★ TRADE PROFIT IS FRONTIER'S OWN ARITHMETIC WHERE POSSIBLE ★
 *
 * MarketSell carries AvgPricePaid — the game's own average over every buy the member ever made,
 * including ones this app never saw. Retained since 2026-08-04; for older events (and members on
 * older app builds) the fallback is the member's average unit cost across their visible MarketBuy
 * events of the same commodity in the prior thirty days. No basis at all means no points rather
 * than invented ones: a sale we cannot price honestly scores nothing.
 */

const CURSORS = {
  colony: 'leaderboard-colony-contributions',
  trade: 'leaderboard-trade-sells',
} as const;

const BATCH = 2_000;

export interface ScoreReport {
  readonly colonyEvents: number;
  readonly tradeEvents: number;
  readonly badgesAwarded: number;
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

// ─────────────────────────────────────────────────────────────────── colony

async function scoreColony(db: PrismaClient): Promise<number> {
  let written = 0;
  let cursor = await cursorOf(db, CURSORS.colony);

  for (;;) {
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: bigint;
        user_id: string;
        project_id: string;
        commodity: string;
        amount: number;
        delivered_at: Date;
        is_priority: boolean;
        remaining: number | null;
        latest_id: bigint | null;
      }>
    >(
      `SELECT c.id, c.user_id, c.project_id, c.commodity, c.amount, c.delivered_at,
              p.is_priority,
              n.remaining,
              latest.latest_id
         FROM colony_contributions c
         JOIN colony_projects p ON p.id = c.project_id
         LEFT JOIN colony_needs n ON n.project_id = c.project_id AND n.commodity = c.commodity
         LEFT JOIN LATERAL (
           SELECT max(c2.id) AS latest_id FROM colony_contributions c2
            WHERE c2.project_id = c.project_id AND c2.commodity = c.commodity
         ) latest ON true
        WHERE c.id > $1 AND c.user_id IS NOT NULL AND c.amount > 0
        ORDER BY c.id
        LIMIT ${BATCH}`,
      String(cursor),
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      const priority = r.is_priority;
      /*
       * The line-closer: the LATEST delivery of a commodity whose need now reads zero. The needs
       * table is a snapshot, so this is judged at scoring time — which is minutes after the
       * delivery, the window in which it is still true. A later top-up to a reopened line becomes
       * the new latest and can earn it again, which is correct: somebody closed it again.
       */
      const lineCloser = r.remaining === 0 && r.latest_id === r.id;
      const points =
        r.amount * (priority ? COLONY_PRIORITY_MULTIPLIER : 1) +
        (lineCloser ? COLONY_LINE_CLOSER_BONUS : 0);

      written += await db.$executeRawUnsafe(
        `INSERT INTO leaderboard_events (user_id, board, points, source_key, meta, occurred_at)
         VALUES ($1::uuid, 'colony', $2, $3, $4::jsonb, $5)
         ON CONFLICT (board, source_key) DO NOTHING`,
        r.user_id,
        points,
        String(r.id),
        JSON.stringify({
          commodity: r.commodity,
          amount: r.amount,
          projectId: r.project_id,
          priority,
          lineCloser,
        }),
        r.delivered_at,
      );
      cursor = r.id;
    }

    await saveCursor(db, CURSORS.colony, cursor);
    if (rows.length < BATCH) break;
  }

  return written;
}

// ─────────────────────────────────────────────────────────────────── trade

interface SellPayload {
  readonly Type?: unknown;
  readonly Count?: unknown;
  readonly TotalSale?: unknown;
  readonly AvgPricePaid?: unknown;
}

async function scoreTrade(db: PrismaClient): Promise<number> {
  let written = 0;
  let cursor = await cursorOf(db, CURSORS.trade);

  for (;;) {
    const rows = await db.$queryRawUnsafe<
      Array<{ id: bigint; user_id: string; event_key: string; occurred_at: Date; payload: SellPayload }>
    >(
      `SELECT id, user_id, event_key, occurred_at, payload
         FROM telemetry_events
        WHERE event_type = 'MarketSell' AND id > $1
        ORDER BY id
        LIMIT ${BATCH}`,
      String(cursor),
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      cursor = r.id;

      const count = num(r.payload.Count);
      const totalSale = num(r.payload.TotalSale);
      const type = typeof r.payload.Type === 'string' ? r.payload.Type : null;
      if (count === null || totalSale === null || count <= 0) continue;

      let basis = num(r.payload.AvgPricePaid);
      if (basis === null && type !== null) {
        // The fallback for events from before AvgPricePaid was retained: the member's own average
        // unit cost across the buys we can see, in the thirty days before the sale.
        const [avg] = await db.$queryRawUnsafe<Array<{ unit: number | null }>>(
          `SELECT sum((payload->>'TotalCost')::bigint)::float
                  / NULLIF(sum((payload->>'Count')::int), 0) AS unit
             FROM telemetry_events
            WHERE user_id = $1::uuid AND event_type = 'MarketBuy'
              AND payload->>'Type' = $2
              AND occurred_at BETWEEN $3::timestamptz - interval '30 days' AND $3::timestamptz`,
          r.user_id,
          type,
          r.occurred_at,
        );
        basis = avg?.unit ?? null;
      }
      if (basis === null) continue; // No honest basis, no points.

      const profit = Math.round(totalSale - basis * count);
      if (profit <= 0) continue;

      const points = Math.floor(profit / TRADE_CREDITS_PER_POINT);
      if (points <= 0 && profit < 1_000_000) continue;

      written += await db.$executeRawUnsafe(
        `INSERT INTO leaderboard_events (user_id, board, points, source_key, meta, occurred_at)
         VALUES ($1::uuid, 'trade', $2, $3, $4::jsonb, $5)
         ON CONFLICT (board, source_key) DO NOTHING`,
        r.user_id,
        points,
        r.event_key,
        JSON.stringify({
          commodity: type,
          count,
          profit,
          millionaire: profit >= 1_000_000,
        }),
        r.occurred_at,
      );
    }

    await saveCursor(db, CURSORS.trade, cursor);
    if (rows.length < BATCH) break;
  }

  return written;
}

// ─────────────────────────────────────────────────────────────────── badges

/**
 * Awards everything newly earned. Append-only, idempotent: awarding is ON CONFLICT DO NOTHING on
 * (user, badge), and nothing here ever revokes — a badge earned under an old rule is history,
 * not an error.
 */
async function sweepBadges(db: PrismaClient): Promise<number> {
  let awarded = 0;

  /*
   * Awards land in member_badges — the FORUM reputation system's table, on purpose. One badge
   * table, one display pipeline; the leaderboard keys are namespaced so the two sweeps can never
   * collide on a key, and neither sweep touches the other's rows (both are append-only).
   */
  const award = async (userId: string, badgeKey: string): Promise<void> => {
    awarded += await db.$executeRawUnsafe(
      `INSERT INTO member_badges (user_id, badge_key) VALUES ($1::uuid, $2)
       ON CONFLICT (user_id, badge_key) DO NOTHING`,
      userId,
      badgeKey,
    );
  };

  // ---- lifetime points per member per board, from each board's own ledger ----
  const totals = await db.$queryRawUnsafe<
    Array<{ user_id: string; board: string; total: number }>
  >(
    `SELECT user_id, board, sum(points)::int AS total
       FROM leaderboard_events GROUP BY user_id, board
     UNION ALL
     SELECT user_id, 'bounties' AS board, sum(points)::int AS total
       FROM bounty_claims GROUP BY user_id`,
  );

  for (const t of totals) {
    for (const tier of tiersEarned(t.board as LeaderboardKey, t.total)) {
      await award(t.user_id, tier.key);
    }
  }

  // ---- achievements, each a single set-based question ----
  const firstAndFlags = await db.$queryRawUnsafe<
    Array<{ user_id: string; badge: string }>
  >(
    `SELECT DISTINCT user_id, 'bounties-first-light' AS badge FROM bounty_claims
     UNION
     SELECT user_id, 'bounties-jackpot-hunter' FROM bounty_claims
      WHERE jackpot GROUP BY user_id HAVING count(*) >= 10
     UNION
     SELECT DISTINCT user_id, 'bounties-cartographer' FROM bounty_claims WHERE days_stale IS NULL
     UNION
     SELECT DISTINCT user_id, 'colony-first-brick' FROM leaderboard_events WHERE board = 'colony'
     UNION
     SELECT user_id, 'colony-priority-hauler' FROM leaderboard_events
      WHERE board = 'colony' AND (meta->>'priority')::boolean
      GROUP BY user_id HAVING sum((meta->>'amount')::int) >= 10000
     UNION
     SELECT DISTINCT user_id, 'colony-line-closer' FROM leaderboard_events
      WHERE board = 'colony' AND (meta->>'lineCloser')::boolean
     UNION
     SELECT DISTINCT user_id, 'trade-first-profit' FROM leaderboard_events
      WHERE board = 'trade' AND points > 0
     UNION
     SELECT DISTINCT user_id, 'trade-millionaire-run' FROM leaderboard_events
      WHERE board = 'trade' AND (meta->>'millionaire')::boolean`,
  );
  for (const f of firstAndFlags) await award(f.user_id, f.badge);

  /*
   * Season champions: the top scorer of every COMPLETED UTC month, per board. Judged only once
   * the month is over — a mid-month leader has won nothing yet — and re-judged idempotently
   * every sweep, so a backfilled event that rewrites an old month's history corrects the award
   * the same way it corrects the board.
   */
  const champions = await db.$queryRawUnsafe<Array<{ user_id: string; badge: string }>>(
    `WITH monthly AS (
       SELECT user_id, board, date_trunc('month', occurred_at AT TIME ZONE 'UTC') AS month,
              sum(points) AS pts
         FROM leaderboard_events
        WHERE occurred_at < date_trunc('month', now() AT TIME ZONE 'UTC')
        GROUP BY user_id, board, 3
       UNION ALL
       SELECT user_id, 'bounties', date_trunc('month', claimed_at AT TIME ZONE 'UTC'), sum(points)
         FROM bounty_claims
        WHERE claimed_at < date_trunc('month', now() AT TIME ZONE 'UTC')
        GROUP BY user_id, 2, 3
     ),
     ranked AS (
       SELECT user_id, board,
              rank() OVER (PARTITION BY board, month ORDER BY pts DESC) AS r
         FROM monthly
     )
     SELECT DISTINCT user_id, board || '-season-champion' AS badge FROM ranked WHERE r = 1`,
  );
  for (const c of champions) await award(c.user_id, c.badge);

  return awarded;
}

export async function scoreLeaderboards(db: PrismaClient): Promise<ScoreReport> {
  const colonyEvents = await scoreColony(db);
  const tradeEvents = await scoreTrade(db);
  const badgesAwarded = await sweepBadges(db);
  return { colonyEvents, tradeEvents, badgesAwarded };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
