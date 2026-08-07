import type { PrismaClient } from '@grims/db';
import { milestonePoints, type RecruitMilestone } from '@grims/shared';

/**
 * How far each recruit has got, and what that pays the member who brought them in.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we want this to be a leaderboard item and gamified too please! we want to encourage our
 * playerbase to beable to invite people into the squadron!"
 *
 * ★ NOTHING IS PAID FOR SOMEBODY ARRIVING ★
 *
 * The decision the whole feature rests on. Pay per join and this is an alt-account farm: ten
 * throwaway accounts in an evening tops the board and the squadron gets ten empty seats. Every
 * point here comes from a milestone a real recruit passes and a throwaway will not — a week
 * survived, a commander verified, a board scored on, a Cadet made.
 *
 * ★ REPLAYABLE, LIKE EVERY OTHER SCORER HERE ★
 *
 * A unique `(discord_id, milestone)` on the ledger and `ON CONFLICT DO NOTHING` on the board mean a
 * crashed run, a rerun or a rewound cursor pays nothing twice. Which is also what lets this be run
 * by hand against history without anybody auditing the result.
 */

/** A week. The first thing an alt farm will not bother to wait for. */
const STAYED_DAYS = 7;

export interface RecruitReport {
  readonly reached: number;
  readonly points: number;
}

/**
 * Award every milestone newly qualified for.
 *
 * ★ ONE QUERY PER RUNG, NOT ONE PER RECRUIT ★
 *
 * Each rung is a single set-based question over the whole cohort — "which recruits are a week old
 * and have no `stayed` row yet". A loop over recruits asking four questions each would be hundreds
 * of round trips to answer something Postgres can answer four times.
 */
export async function awardRecruitMilestones(db: PrismaClient): Promise<RecruitReport> {
  let reached = 0;
  let points = 0;

  /*
   * ★ VOIDED CLAIMS EARN NOTHING FURTHER ★
   *
   * Every rung joins through this. A claim an officer has voided keeps the points already banked —
   * reversing those is a deliberate act in the recruiting manager, not a side effect of a sweep —
   * but it stops accruing, which is the whole point of voiding it.
   *
   * And a join with no recruiter is skipped entirely: there is nobody to pay.
   */
  const LIVE = `j.voided_at IS NULL AND j.recruiter_id IS NOT NULL`;

  const rungs: ReadonlyArray<{ milestone: RecruitMilestone; qualifies: string }> = [
    {
      /* Still here a week later. */
      milestone: 'stayed',
      qualifies: `j.joined_at <= now() - interval '${STAYED_DAYS} days'`,
    },
    {
      /* A real commander account behind them — the same bar their recruiter had to clear. */
      milestone: 'verified',
      qualifies: `EXISTS (
        SELECT 1 FROM inara_links il
         WHERE il.user_id = j.user_id AND il.verified_at IS NOT NULL
      )`,
    },
    {
      /*
       * Scoring on any board of their own. Present is one thing; flying with us is another, and it
       * is the first sign a recruit has become a member rather than a name in a channel.
       */
      milestone: 'flying',
      qualifies: `EXISTS (
        SELECT 1 FROM leaderboard_events le WHERE le.user_id = j.user_id
      )`,
    },
    {
      /*
       * The capstone: a qualifying month. `rank_order >= 100` is Cadet — the floor of the tenure
       * ladder, and the same constant the mint gate uses, because "became a member" and "may
       * recruit" are deliberately the same bar.
       */
      milestone: 'cadet',
      qualifies: `EXISTS (
        SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = j.user_id AND r.rank_order >= 100
      )`,
    },
  ];

  for (const rung of rungs) {
    const pay = milestonePoints(rung.milestone);

    /*
     * The ledger row first, and its affected-row count is the ONLY signal that this is new. A
     * rerun inserts nothing and therefore announces nothing — the same shape every scorer on this
     * platform uses, and the reason none of them can double-pay.
     */
    const fresh = await db.$queryRawUnsafe<Array<{ discord_id: string; recruiter_id: string }>>(
      `INSERT INTO recruit_milestones (discord_id, milestone, points)
       SELECT j.discord_id, $1, $2
         FROM recruit_joins j
        WHERE ${LIVE}
          AND j.user_id IS NOT NULL
          AND ${rung.qualifies}
          AND NOT EXISTS (
            SELECT 1 FROM recruit_milestones m
             WHERE m.discord_id = j.discord_id AND m.milestone = $1
          )
       ON CONFLICT (discord_id, milestone) DO NOTHING
       RETURNING discord_id,
                 (SELECT recruiter_id FROM recruit_joins WHERE discord_id = recruit_milestones.discord_id) AS recruiter_id`,
      rung.milestone,
      pay,
    );

    reached += fresh.length;
    if (pay <= 0) continue;

    for (const row of fresh) {
      /*
       * Scored to the RECRUITER, not the recruit. Keyed on the recruit and the rung so the board
       * cannot be paid twice for one milestone even if this job is run again by hand.
       */
      await db.$executeRawUnsafe(
        `INSERT INTO leaderboard_events (user_id, board, points, source_key, meta, occurred_at)
         VALUES ($1::uuid, 'recruit', $2, $3, $4::jsonb, now())
         ON CONFLICT (board, source_key) DO NOTHING`,
        row.recruiter_id,
        pay,
        `${row.discord_id}:${rung.milestone}`,
        JSON.stringify({ milestone: rung.milestone, recruit: row.discord_id }),
      );
      points += pay;
    }
  }

  return { reached, points };
}
