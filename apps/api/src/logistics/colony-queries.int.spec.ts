import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';

/**
 * The project queries actually run.
 *
 * ★ WHY THIS EXISTS — A REAL BREAK THAT SHIPPED ★
 *
 * The board and detail reads are hand-written SQL with a `GROUP BY`. Joining the build catalogue in
 * meant adding five columns to the SELECT, and Postgres refuses a non-aggregated column that is not
 * grouped by — so BOTH reads started failing, and the companion app showed "an unexpected error
 * occurred" on every colonisation screen.
 *
 * Nothing caught it. Typecheck cannot see inside a `$queryRawUnsafe` string, the unit tests mock
 * the client, and lint has no opinion about SQL. The only thing that would have caught it is
 * running the query, which is what this does.
 *
 * ★ IT ASSERTS ALMOST NOTHING ABOUT THE RESULT, ON PURPOSE ★
 *
 * The value is in the query being ACCEPTED by a real Postgres with the real schema. Asserting on
 * rows would make it depend on seed data and start failing for reasons that are not defects.
 */

const db = new PrismaClient();

/** The same shape both reads use, so a grouping mistake in either is caught here. */
const PROJECT_SELECT = `
  SELECT p.id, p.owner::text AS owner, p.title, p.system_name, p.station_name, p.build_type,
         p.market_id::text AS market_id,
         p.build_type_id, bt.display_name AS build_type_name, bt.tier AS build_tier,
         bt.pad_size AS build_pad, bt.location AS build_location,
         bt.total_tonnes AS build_total,
         p.notes, p.visibility::text AS visibility, p.share_token, p.is_priority,
         p.completed_at, p.posted_by_id, p.updated_at,
         u.display_name AS posted_by,
         COALESCE(SUM(n.remaining), 0)::bigint AS remaining,
         COALESCE(SUM(n.required), 0)::bigint  AS required,
         COUNT(n.commodity)::int               AS need_count
    FROM colony_projects p
    LEFT JOIN colony_build_types bt ON bt.id = p.build_type_id
    JOIN users u ON u.id = p.posted_by_id
    LEFT JOIN colony_needs n ON n.project_id = p.id
   GROUP BY p.id, u.display_name, bt.id
   LIMIT 1`;

describe('the colonisation project reads', () => {
  it('runs the grouped project query Postgres actually has to accept', async () => {
    // Throws on a grouping mistake before it can reach a member's screen.
    await expect(db.$queryRawUnsafe(PROJECT_SELECT)).resolves.toBeInstanceOf(Array);
  });

  it('groups by the catalogue PRIMARY KEY rather than every column of it', async () => {
    /*
     * `GROUP BY bt.id` is what makes every other `bt.*` column legal — Postgres allows columns
     * functionally dependent on a grouped primary key. Listing all five instead would work
     * identically and would need editing again the next time a column is added, which is exactly
     * the maintenance that produced the bug.
     *
     * Proven by removing it and watching the same query fail.
     */
    const withoutIt = PROJECT_SELECT.replace('GROUP BY p.id, u.display_name, bt.id', 'GROUP BY p.id, u.display_name');
    await expect(db.$queryRawUnsafe(withoutIt)).rejects.toThrow();
  });

  it('runs the build catalogue queries', async () => {
    await expect(
      db.$queryRawUnsafe(`
        SELECT b.id, b.display_name, b.category, b.tier, b.location, b.pad_size,
               b.total_tonnes, b.source, b.confirmations, count(c.commodity) AS commodities
          FROM colony_build_types b
          LEFT JOIN colony_build_costs c ON c.build_type_id = b.id
         GROUP BY b.id
         ORDER BY b.tier, b.total_tonnes
         LIMIT 1`),
    ).resolves.toBeInstanceOf(Array);
  });
});

/**
 * The delivery chart read, the same shape `ColonyService.deliveryChart` runs — `$3` is the
 * viewer's IANA zone, and `to_char` freezes the zone-local bucket into text so no driver or
 * client can reinterpret it as an instant again.
 */
const CHART_SELECT = `
  SELECT to_char(date_trunc($2, c.delivered_at AT TIME ZONE $3), 'YYYY-MM-DD"T"HH24:MI') AS at,
         c.commodity,
         u.display_name AS commander,
         SUM(c.amount)::bigint AS amount
    FROM colony_contributions c
    LEFT JOIN users u ON u.id = c.user_id
   WHERE c.project_id = $1::uuid
   GROUP BY 1, 2, 3
   ORDER BY 1`;

describe('the delivery chart bucketing', () => {
  it('runs the tz-aware chart query Postgres actually has to accept', async () => {
    // The project id matches nothing on purpose — the value is the query being ACCEPTED, exactly
    // as the reads above are tested, not in whatever rows this database happens to hold.
    await expect(
      db.$queryRawUnsafe(CHART_SELECT, '00000000-0000-0000-0000-000000000000', 'day', 'America/Denver'),
    ).resolves.toBeInstanceOf(Array);
  });

  it('puts a 23:30-local delivery in the viewer’s local day, not UTC’s next day', async () => {
    /*
     * ★ THE REPORTED BUG, REDUCED TO ONE ROW ★
     *
     * 05:30 UTC on 4 August IS 23:30 on 3 August in Denver. Truncated the old way — in the
     * session's zone, UTC — that delivery lands on the 4th, and a member who hauled all evening
     * watched their bars stack onto yesterday. Truncated in the viewer's zone it lands on the
     * 3rd, the evening they actually flew. Fixed instants, so no seed data and no flakiness;
     * asserting BOTH sides proves the `AT TIME ZONE` is doing the work rather than the test
     * passing vacuously.
     */
    const rows = await db.$queryRawUnsafe<Array<{ denver: string; utc: string }>>(`
      SELECT to_char(date_trunc('day', t AT TIME ZONE 'America/Denver'), 'YYYY-MM-DD"T"HH24:MI') AS denver,
             to_char(date_trunc('day', t AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI') AS utc
        FROM (SELECT TIMESTAMPTZ '2026-08-04 05:30:00+00' AS t) delivery`);

    expect(rows[0]?.denver).toBe('2026-08-03T00:00');
    expect(rows[0]?.utc).toBe('2026-08-04T00:00');
  });
});
