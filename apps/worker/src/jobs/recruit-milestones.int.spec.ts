import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { awardRecruitMilestones } from './recruit-milestones.js';

/**
 * The milestone sweep, actually run.
 *
 * ★ THE SAME REASONING AS mining-ingest.int.spec.ts ★
 *
 * Every rung is hand-written SQL with a correlated EXISTS, an anti-join and a RETURNING clause.
 * None of it typechecks. A wrong column, a join to the wrong table, or an anti-join that does not
 * actually exclude would all ship green and then either pay nobody or pay everybody twice — and
 * this is a LEADERBOARD, where both failures are public.
 *
 * ★ THE ASSERTION THAT MATTERS MOST IS THE SECOND RUN ★
 *
 * A sweep that pays twice is worse than one that pays nothing: the first is a member's name beside
 * points they did not earn, argued about in Discord. So this runs the whole thing twice and proves
 * the second changes nothing.
 */

const db = new PrismaClient();
const TAG = 'recruit-milestones-int-spec';

async function seed(): Promise<{ recruiter: string; recruit: string; discordId: string }> {
  const [recruiter] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    `${TAG}-recruiter`,
  );
  const [recruit] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    `${TAG}-recruit`,
  );

  const discordId = `${TAG}-discord`;

  // Joined eight days ago, so the week-old rung is genuinely due rather than nearly due.
  await db.$executeRawUnsafe(
    `INSERT INTO recruit_joins (discord_id, recruiter_id, invite_code, attribution, joined_at, user_id)
     VALUES ($1, $2::uuid, $3, 'auto', now() - interval '8 days', $4::uuid)
     ON CONFLICT (discord_id) DO UPDATE
        SET recruiter_id = EXCLUDED.recruiter_id, user_id = EXCLUDED.user_id,
            joined_at = EXCLUDED.joined_at, voided_at = NULL`,
    discordId,
    (recruiter as { id: string }).id,
    `${TAG}-code`,
    (recruit as { id: string }).id,
  );

  return {
    recruiter: (recruiter as { id: string }).id,
    recruit: (recruit as { id: string }).id,
    discordId,
  };
}

async function cleanUp(ids: { recruiter: string; recruit: string; discordId: string }): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM recruit_milestones WHERE discord_id = $1`, ids.discordId);
  await db.$executeRawUnsafe(`DELETE FROM recruit_joins WHERE discord_id = $1`, ids.discordId);
  await db.$executeRawUnsafe(
    `DELETE FROM leaderboard_events WHERE user_id IN ($1::uuid, $2::uuid)`,
    ids.recruiter,
    ids.recruit,
  );
  await db.$executeRawUnsafe(
    `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`,
    ids.recruiter,
    ids.recruit,
  );
}

describe('awarding recruit milestones, against Postgres', () => {
  it(
    'pays the recruiter for a recruit who stayed, and pays it exactly once',
    async () => {
      const ids = await seed();

      try {
        const first = await awardRecruitMilestones(db);
        expect(first.reached, 'a week-old recruit reached no milestone at all').toBeGreaterThan(0);

        const [stayed] = await db.$queryRawUnsafe<Array<{ points: number }>>(
          `SELECT points FROM recruit_milestones WHERE discord_id = $1 AND milestone = 'stayed'`,
          ids.discordId,
        );
        expect(stayed?.points, 'the stayed rung was not banked').toBeGreaterThan(0);

        const [board] = await db.$queryRawUnsafe<Array<{ n: number; total: number }>>(
          `SELECT count(*)::int AS n, coalesce(sum(points), 0)::int AS total
             FROM leaderboard_events WHERE user_id = $1::uuid AND board = 'recruit'`,
          ids.recruiter,
        );
        expect(board?.n, 'the RECRUITER was not credited').toBeGreaterThan(0);

        /*
         * ★ THE RUN THAT MUST CHANGE NOTHING ★
         *
         * Paying twice puts points beside a member's name that they did not earn, on a public
         * board. This is the assertion the whole replayable design exists to make safe.
         */
        await awardRecruitMilestones(db);

        const [again] = await db.$queryRawUnsafe<Array<{ n: number; total: number }>>(
          `SELECT count(*)::int AS n, coalesce(sum(points), 0)::int AS total
             FROM leaderboard_events WHERE user_id = $1::uuid AND board = 'recruit'`,
          ids.recruiter,
        );
        expect(again?.n, 'a second sweep paid the same milestone again').toBe(board?.n);
        expect(again?.total).toBe(board?.total);
      } finally {
        await cleanUp(ids);
      }
    },
    60_000,
  );

  it(
    'pays nothing further once a claim is voided',
    async () => {
      const ids = await seed();

      try {
        /*
         * Voided BEFORE the first sweep, so nothing has been banked. The rule being proved is that
         * a voided claim stops accruing — not that banked points are clawed back, which is a
         * deliberate act in the recruiting manager rather than a side effect of a sweep.
         */
        await db.$executeRawUnsafe(
          `UPDATE recruit_joins SET voided_at = now(), void_reason = 'test' WHERE discord_id = $1`,
          ids.discordId,
        );

        await awardRecruitMilestones(db);

        const [board] = await db.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM leaderboard_events
            WHERE user_id = $1::uuid AND board = 'recruit'`,
          ids.recruiter,
        );
        expect(board?.n, 'a voided claim still paid the recruiter').toBe(0);
      } finally {
        await cleanUp(ids);
        await db.$disconnect();
      }
    },
    60_000,
  );
});
