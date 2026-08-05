import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { LEADERBOARDS } from '@grims/shared';
import { LeaderboardsService } from './leaderboards.service.js';

/**
 * The standings queries actually run.
 *
 * ★ THE SAME REASONING AS colony-queries.int.spec.ts ★
 *
 * Every read in the service is hand-written SQL with a GROUP BY, a FILTER clause, a CTE and a
 * LEFT JOIN against `privacy_settings` — none of which typecheck, unit tests or lint can see
 * inside a `$queryRawUnsafe` string. A column renamed in the schema, a grouping mistake, or a
 * privacy column that does not exist would all ship green and fail on the first page load. The
 * only thing that catches that class of break is a real Postgres accepting the query, which is
 * what this does.
 *
 * ★ IT ASSERTS ALMOST NOTHING ABOUT THE ROWS, ON PURPOSE ★
 *
 * Standings depend on what members have actually done; asserting on them would make this fail
 * for reasons that are not defects. The opt-out SEMANTICS (COALESCE, rank arithmetic, shaping)
 * are proven in `leaderboards.service.spec.ts` against scripted rows.
 */

const db = new PrismaClient();
const svc = new LeaderboardsService(db);

/** A well-formed UUID no member holds, so the `me` CTE runs its whole shape and sums to zero. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

describe('the leaderboard standings reads', () => {
  it('runs every board query Postgres actually has to accept — season, all-time and me', async () => {
    const out = await svc.standings('2026-08', NOBODY);

    expect(out).not.toBeNull();
    expect(out?.boards).toHaveLength(LEADERBOARDS.length);

    for (const board of out?.boards ?? []) {
      expect(Array.isArray(board.season)).toBe(true);
      expect(Array.isArray(board.allTime)).toBe(true);
      // A member with no deeds anywhere: zero points, no rank. Anything else means the CTE
      // misread an empty result — the one caller state every new member starts in.
      expect(board.me).toEqual({ seasonPoints: 0, lifetimePoints: 0, seasonRank: null });
    }
  });

  it('runs the badge reads against the real member_badges table', async () => {
    await expect(svc.badgesOf(NOBODY)).resolves.toEqual([]);
    await expect(svc.showcaseFor([NOBODY], 3)).resolves.toEqual(new Map());
  });
});
