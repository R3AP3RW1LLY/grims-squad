import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@grims/db';
import { BADGES, XP_AWARDS } from '@grims/shared';
import { awardPlayDays, awardBadges, AWARDABLE } from './reputation.js';

/**
 * The nightly reputation job.
 *
 * ★ IDEMPOTENCE IS THE WHOLE TEST SUITE ★
 *
 * Everything here runs again tomorrow over data that mostly has not changed, and re-runs happen
 * for boring reasons — a retry, a manual invocation, two cron entries that overlap. A ledger that
 * double-counts is worse than no ledger, because it still looks authoritative and nobody can tell
 * which entries are the spurious ones.
 */

interface Created {
  data: unknown[];
  skipDuplicates?: boolean;
}

function fakeDb(opts: {
  days?: unknown[];
  totals?: unknown[];
  held?: Array<{ userId: string; badgeKey: string }>;
}) {
  const calls: { xp: Created[]; badges: Created[] } = { xp: [], badges: [] };

  const db = {
    /*
     * Dispatches on the QUERY, not on call order.
     *
     * The first version returned days-then-totals by counting calls, which worked only when both
     * functions ran in sequence — every test that exercises `awardBadges` on its own got the days
     * array instead, and reported no badges. The failure looked like a bug in the awarding logic.
     */
    $queryRawUnsafe: async (q: string) =>
      q.includes('telemetry_events') ? (opts.days ?? []) : (opts.totals ?? []),
    xpEvent: {
      createMany: async (c: Created) => {
        calls.xp.push(c);
        return { count: c.data.length };
      },
    },
    memberBadge: {
      findMany: async () => opts.held ?? [],
      createMany: async (c: Created) => {
        calls.badges.push(c);
        return { count: c.data.length };
      },
    },
  } as unknown as PrismaClient;

  return { db, calls };
}

describe('experience for showing up', () => {
  it('awards one per member per DAY, not per event', async () => {
    /*
     * Per event would reward whoever produces the most journal lines — a measure of what somebody
     * flies rather than of whether they turned up.
     */
    const { db, calls } = fakeDb({
      days: [
        { user_id: 'u1', day: '2026-07-30' },
        { user_id: 'u1', day: '2026-07-31' },
        { user_id: 'u2', day: '2026-07-31' },
      ],
    });

    const n = await awardPlayDays(db);

    expect(n).toBe(3);
    expect(calls.xp[0]?.data).toEqual([
      { userId: 'u1', reason: 'playedToday', amount: XP_AWARDS.playedToday, subject: '2026-07-30' },
      { userId: 'u1', reason: 'playedToday', amount: XP_AWARDS.playedToday, subject: '2026-07-31' },
      { userId: 'u2', reason: 'playedToday', amount: XP_AWARDS.playedToday, subject: '2026-07-31' },
    ]);
  });

  it('MANDATORY: relies on skipDuplicates so a re-run awards nothing twice', async () => {
    /*
     * The date is the SUBJECT, and the partial unique index on (user_id, reason, subject) is what
     * makes tomorrow's run — which sees the same ninety days — a no-op for the days it already
     * paid for.
     */
    const { db, calls } = fakeDb({ days: [{ user_id: 'u1', day: '2026-07-31' }] });

    await awardPlayDays(db);

    expect(calls.xp[0]?.skipDuplicates).toBe(true);
  });

  it('writes nothing at all when there is no telemetry', async () => {
    const { db, calls } = fakeDb({ days: [] });

    expect(await awardPlayDays(db)).toBe(0);
    expect(calls.xp).toHaveLength(0);
  });
});

describe('badges', () => {
  it('awards a threshold the member has crossed', async () => {
    const { db, calls } = fakeDb({
      totals: [{ user_id: 'u1', xp: 100n, answers_accepted: 1n, post_upvotes: 0n, days_played: 0n }],
    });

    const r = await awardBadges(db);

    expect(r.awarded).toBe(1);
    expect(calls.badges[0]?.data).toEqual([{ userId: 'u1', badgeKey: 'first-answer' }]);
  });

  it('MANDATORY: does not re-award a badge already held', async () => {
    /*
     * Without this the insert grows by every badge every member holds, every night — and relies
     * entirely on a constraint to throw it away. Correct, and it means the nightly job's cost
     * grows with the squadron's history rather than with what changed.
     */
    const { db, calls } = fakeDb({
      totals: [{ user_id: 'u1', xp: 100n, answers_accepted: 1n, post_upvotes: 0n, days_played: 0n }],
      held: [{ userId: 'u1', badgeKey: 'first-answer' }],
    });

    const r = await awardBadges(db);

    expect(r.awarded).toBe(0);
    expect(calls.badges).toHaveLength(0);
  });

  it('still passes skipDuplicates, so two runs racing is harmless', async () => {
    /*
     * The check above keeps the insert small. THIS is what stops a race between two runs becoming
     * a primary-key violation that aborts the batch and loses everybody else's badges too.
     */
    const { db, calls } = fakeDb({
      totals: [{ user_id: 'u1', xp: 0n, answers_accepted: 1n, post_upvotes: 0n, days_played: 0n }],
    });

    await awardBadges(db);

    expect(calls.badges[0]?.skipDuplicates).toBe(true);
  });

  it('awards several at once when several thresholds are crossed together', async () => {
    // A member's first nightly run after joining mid-history crosses more than one at a time.
    const { db, calls } = fakeDb({
      totals: [{ user_id: 'u1', xp: 900n, answers_accepted: 10n, post_upvotes: 30n, days_played: 40n }],
    });

    const keys = (calls.badges[0]?.data ?? []) as Array<{ badgeKey: string }>;
    await awardBadges(db);

    const awarded = ((calls.badges[0]?.data ?? []) as Array<{ badgeKey: string }>).map((b) => b.badgeKey);
    expect(awarded).toContain('first-answer');
    expect(awarded).toContain('navigator');
    expect(awarded).toContain('well-received');
    expect(awarded).toContain('regular');
    expect(keys).toBeDefined();
  });
});

describe('the job and the contract agree', () => {
  it('can award every badge the contract defines', () => {
    // A badge added to BADGES but unreachable here would simply never be earned, and nothing
    // anywhere would say so.
    expect(AWARDABLE.sort()).toEqual(BADGES.map((b) => b.key).sort());
  });
});
