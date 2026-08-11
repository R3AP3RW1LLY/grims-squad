import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromotionEngine,
  type PromotionStore,
  type MemberStanding,
  type LadderRung,
} from './promotion-run.js';
import { EARLIEST_PROMOTION_AT } from '@grims/shared';

/**
 * P1 — the monthly promotion engine, in DRY-RUN.
 *
 * ★★ THE HARD FLOOR ★★
 *
 * "DO NOT START ASSIGNING PROMOTIONS UNTIL AUGUST 1ST 2026! THIS IS
 * NON-NEGOTIABLE!" — the human, 2026-07-27.
 *
 * That is a CODED GUARD with its own tests, not a cron expression that happens
 * not to fire yet. A schedule can be triggered by hand, by a deploy, by someone
 * testing; a guard cannot. July 2026 is partial data — the bot began recording
 * on the 27th and backfilled only to the 1st — so July can never be a fair
 * qualifying month for anyone, and a promotion granted on it would be wrong in
 * a way that is embarrassing to explain and tedious to reverse.
 *
 * Everything here also runs in DRY-RUN by default. The engine reports what it
 * WOULD do; a human reviews that report before anything is ever written.
 */

/*
 * `cumulativeMonths` mirrors the SSOT exactly — 1, 2, 3, 9, 12 — including the deliberate gaps
 * before Lord General and Grand Master General. It is what the Discord-tenure requirement measures
 * against, and a fixture that omitted it would quietly fall back to the per-rank figure and test a
 * rule the production ladder does not have.
 */
const LADDER: LadderRung[] = [
  { rank: 'Cadet', qualifyingMonthsRequired: 1, next: 'Sergeant', cumulativeMonths: 1 },
  { rank: 'Sergeant', qualifyingMonthsRequired: 1, next: 'Master Sergeant', cumulativeMonths: 2 },
  {
    rank: 'Master Sergeant',
    qualifyingMonthsRequired: 1,
    next: '2nd Lieutenant',
    cumulativeMonths: 3,
  },
  { rank: 'General', qualifyingMonthsRequired: 2, next: 'Lord General', cumulativeMonths: 9 },
  {
    rank: 'Lord General',
    qualifyingMonthsRequired: 3,
    next: 'Grand Master General',
    cumulativeMonths: 12,
  },
  {
    rank: 'Grand Master General',
    qualifyingMonthsRequired: null,
    next: null,
    cumulativeMonths: 12,
  },
];

const AFTER_FLOOR = new Date('2026-08-01T00:00:00.000Z');
const BEFORE_FLOOR = new Date('2026-07-31T23:59:59.999Z');

class FakeStore implements PromotionStore {
  /** Named `rows`, not `standings`: a field of that name would SHADOW the
   *  interface method of the same name and every call would fail at runtime. */
  rows: MemberStanding[] = [];
  applied: Array<{ userId: string; from: string; to: string }> = [];
  audit: Array<Record<string, unknown>> = [];

  async ladder(): Promise<LadderRung[]> {
    return LADDER;
  }
  async standings(): Promise<MemberStanding[]> {
    return this.rows;
  }
  async applyPromotion(userId: string, from: string, to: string): Promise<void> {
    this.applied.push({ userId, from, to });
  }
  async writeAudit(e: Record<string, unknown>): Promise<void> {
    this.audit.push(e);
  }
}

const member = (over: Partial<MemberStanding> = {}): MemberStanding => ({
  userId: 'u1',
  handle: 'grim',
  currentRank: 'Cadet',
  qualifyingMonthsAtRank: 1,
  heldRankSince: new Date('2026-06-01T00:00:00Z'),
  /*
   * ★ ADDED WITH THE DISCORD-TENURE RULE — SQUADRON OWNER, 2026-08-11 ★
   *
   * Long-standing by default, so the tests either side of this line keep testing what they were
   * written to test — activity eligibility and the floor — rather than silently becoming tests of
   * the tenure gate. The gate has its own tests below, and `promotion-tenure.spec.ts` covers the
   * date arithmetic.
   *
   * Every one of these went red when the gate landed, which is the gate working: a fixture with no
   * join date is exactly the case that must be refused.
   */
  joinedServerAt: new Date('2020-01-01T00:00:00Z'),
  ...over,
});

/**
 * A no-op rank applier.
 *
 * These tests are about ELIGIBILITY — who qualifies and when — not about
 * Discord. A live run refuses without an applier (see promotion-discord.spec.ts
 * for why), so one is supplied here and does nothing. The Discord interaction
 * is tested where it belongs rather than incidentally in every eligibility case.
 */
const noopApplier = { applyRank: async (): Promise<void> => undefined };

let store: FakeStore;
let engine: PromotionEngine;

beforeEach(() => {
  store = new FakeStore();
  engine = new PromotionEngine(store, noopApplier);
});

describe('★ the 1 August 2026 floor — NON-NEGOTIABLE ★', () => {
  it('MANDATORY: refuses to write ANY promotion before 2026-08-01T00:00:00Z', async () => {
    store.rows = [member({ qualifyingMonthsAtRank: 12 })];

    await expect(engine.run({ now: BEFORE_FLOOR, dryRun: false })).rejects.toThrow(
      /2026|not yet|august/i,
    );
    expect(store.applied).toEqual([]);
  });

  it('MANDATORY: refuses even one millisecond before the floor', async () => {
    // The boundary, stated exactly. An off-by-one here promotes on 31 July.
    store.rows = [member({ qualifyingMonthsAtRank: 12 })];
    const oneMsBefore = new Date(EARLIEST_PROMOTION_AT.getTime() - 1);

    await expect(engine.run({ now: oneMsBefore, dryRun: false })).rejects.toThrow();
    expect(store.applied).toEqual([]);
  });

  it('permits a write exactly AT the floor instant', async () => {
    store.rows = [member()];
    await expect(
      engine.run({ now: EARLIEST_PROMOTION_AT, dryRun: false }),
    ).resolves.toBeDefined();
  });

  it('MANDATORY: a DRY RUN before the floor still works — it writes nothing anyway', async () => {
    // This is how the human reviews the engine before August. Blocking the dry
    // run would leave no way to check the logic until the day it goes live,
    // which is the worst possible day to discover it is wrong.
    store.rows = [member({ qualifyingMonthsAtRank: 5 })];

    const report = await engine.run({ now: BEFORE_FLOOR, dryRun: true });
    expect(report.wouldPromote).toHaveLength(1);
    expect(store.applied).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('the floor matches the SSOT to the millisecond', () => {
    expect(EARLIEST_PROMOTION_AT.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('dry run is the default', () => {
  it('MANDATORY: writes nothing when dryRun is not specified at all', async () => {
    // A caller who forgets the flag must get the SAFE behaviour. Defaulting to
    // live means a mistyped script promotes the squadron.
    store.rows = [member()];
    await engine.run({ now: AFTER_FLOOR });
    expect(store.applied).toEqual([]);
  });

  it('reports what it WOULD do, with names and both ranks', async () => {
    // A count is useless for review. The human has to be able to read the list
    // and say "no, not that one".
    store.rows = [member({ handle: 'grim' })];
    const report = await engine.run({ now: AFTER_FLOOR });

    expect(report.wouldPromote[0]).toMatchObject({
      handle: 'grim',
      from: 'Cadet',
      to: 'Sergeant',
    });
  });
});

describe('eligibility', () => {
  it('promotes a member who has banked enough qualifying months', async () => {
    store.rows = [member({ qualifyingMonthsAtRank: 1 })];
    const r = await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([{ userId: 'u1', from: 'Cadet', to: 'Sergeant' }]);
    expect(r.promoted).toBe(1);
  });

  it('does not promote a member short of the requirement', async () => {
    store.rows = [member({ qualifyingMonthsAtRank: 0 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([]);
  });

  it('honours the deliberate TWO-month gap at General', async () => {
    // There is no 8-month rank. A member with one qualifying month at General
    // waits.
    store.rows = [member({ currentRank: 'General', qualifyingMonthsAtRank: 1 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([]);

    store.rows = [member({ currentRank: 'General', qualifyingMonthsAtRank: 2 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([{ userId: 'u1', from: 'General', to: 'Lord General' }]);
  });

  it('honours the deliberate THREE-month gap at Lord General', async () => {
    store.rows = [member({ currentRank: 'Lord General', qualifyingMonthsAtRank: 2 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([]);
  });

  it('MANDATORY: promotes at most ONE step per run, however many months are banked', async () => {
    // Advancement should be visible and celebrated. Two at once reads like a
    // bug even when it is arithmetically correct.
    store.rows = [member({ qualifyingMonthsAtRank: 99 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([{ userId: 'u1', from: 'Cadet', to: 'Sergeant' }]);
  });

  it('never promotes past the top of the ladder', async () => {
    store.rows = [member({ currentRank: 'Grand Master General', qualifyingMonthsAtRank: 99 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([]);
  });

  it('MANDATORY: ignores anyone not ON the ladder', async () => {
    // 56 members are unenrolled by design — they have never been granted Cadet,
    // which marks onboarding complete. An engine that swept them in would
    // promote people nobody has onboarded.
    store.rows = [member({ currentRank: 'Recruit', qualifyingMonthsAtRank: 99 })];
    const r = await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([]);
    expect(r.skipped.some((s) => s.reason.includes('not on the ladder'))).toBe(true);
  });

  it('never DEMOTES, whatever the numbers say', async () => {
    // The human ruled demotion out entirely. Inactivity withholds the next
    // rank; it never takes one away.
    store.rows = [member({ currentRank: 'General', qualifyingMonthsAtRank: 0 })];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });
    expect(store.applied).toEqual([]);
  });
});

describe('audit @INV-009', () => {
  it('writes an audited row for every applied promotion', async () => {
    store.rows = [member()];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });

    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]?.['actorId']).toBeNull();
    expect(JSON.stringify(store.audit[0])).toContain('Sergeant');
  });

  it('MANDATORY: a dry run writes NO audit rows', async () => {
    // An audit log recording promotions that did not happen is worse than none.
    store.rows = [member()];
    await engine.run({ now: AFTER_FLOOR, dryRun: true });
    expect(store.audit).toEqual([]);
  });
});

describe('the report', () => {
  it('explains every skip, so a member asking "why not me" gets an answer', async () => {
    store.rows = [
      member({ userId: 'u1', handle: 'short', qualifyingMonthsAtRank: 0 }),
      member({ userId: 'u2', handle: 'top', currentRank: 'Grand Master General' }),
      member({ userId: 'u3', handle: 'off-ladder', currentRank: 'Recruit' }),
    ];
    const r = await engine.run({ now: AFTER_FLOOR });

    expect(r.skipped).toHaveLength(3);
    for (const s of r.skipped) expect(s.reason.length).toBeGreaterThan(0);
  });

  it('states plainly whether it was a dry run', async () => {
    // The single most important line in the report. Reading a dry run as real
    // means believing promotions happened that did not.
    store.rows = [member()];
    expect((await engine.run({ now: AFTER_FLOOR })).dryRun).toBe(true);
    expect((await engine.run({ now: AFTER_FLOOR, dryRun: false })).dryRun).toBe(false);
  });
});

/**
 * ★ TIME IN THE DISCORD SERVER — SQUADRON OWNER, 2026-08-11 ★
 *
 * "for the initial promotion from cadet to sargeant, the member needs to be in the discord server
 * for 1 calender month ... then add this as a requirement for all other ranks"
 *
 * Activity and belonging are different questions. The qualifying-months rule measures whether
 * somebody took part; it says nothing about how long they have been here, and a member who joins on
 * the 28th, talks for three days and plays can bank a whole qualifying month.
 *
 * The date arithmetic itself is pinned in `promotion-tenure.spec.ts`. These are about the ENGINE
 * honouring it, and about the two rules being independent — passing one must not excuse the other.
 */
describe('time in the Discord server', () => {
  it('★ MANDATORY: an active member who just joined is held back ★', () => {
    /*
     * madhatter100690 on production: joined 16 July, banked a qualifying month, and was due
     * Cadet → Sergeant on the August run. Under this rule they wait until 16 August.
     */
    const store = new FakeStore();
    store.rows = [
      member({
        handle: 'madhatter100690',
        qualifyingMonthsAtRank: 1,
        heldRankSince: new Date('2026-07-16T00:00:00Z'),
        joinedServerAt: new Date('2026-07-16T00:00:00Z'),
      }),
    ];

    const engine = new PromotionEngine(store);
    return engine.run({ now: new Date('2026-08-11T00:00:00Z'), dryRun: true }).then((report) => {
      expect(report.wouldPromote).toEqual([]);
      expect(report.skipped[0]?.reason, 'the refusal must say WHEN, not merely no').toMatch(
        /2026-08-16/,
      );
    });
  });

  it('★ MANDATORY: the same member promotes on the day they reach a month ★', async () => {
    const store = new FakeStore();
    store.rows = [
      member({
        qualifyingMonthsAtRank: 1,
        heldRankSince: new Date('2026-07-16T00:00:00Z'),
        joinedServerAt: new Date('2026-07-16T00:00:00Z'),
      }),
    ];

    const engine = new PromotionEngine(store);
    const report = await engine.run({ now: new Date('2026-08-16T00:00:00Z'), dryRun: true });
    expect(report.wouldPromote).toHaveLength(1);
    expect(report.wouldPromote[0]?.to).toBe('Sergeant');
  });

  it('★ MANDATORY: no join date on record REFUSES, and says how to fix it ★', async () => {
    /*
     * The owner's own choice, and deliberately the opposite of the game-activity check which fails
     * open. There, failing open costs a member a month they earned; here it would grant a rank they
     * did not, in public, on a record nobody can defend.
     */
    const store = new FakeStore();
    store.rows = [member({ qualifyingMonthsAtRank: 12, joinedServerAt: null })];

    const engine = new PromotionEngine(store);
    const report = await engine.run({ now: new Date('2026-09-01T00:00:00Z'), dryRun: true });

    expect(report.wouldPromote).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/no discord join date/i);
    expect(report.skipped[0]?.reason, 'a refusal nobody can act on is a dead end').toMatch(
      /officer/i,
    );
  });

  it('★ MANDATORY: the senior ranks demand the ladder’s cumulative months in the server ★', async () => {
    /*
     * The point of applying it beyond Cadet. Somebody three months in the server cannot hold a rank
     * the ladder says represents nine, however active they have been — which is precisely what a
     * tenure rule is for.
     */
    const store = new FakeStore();
    store.rows = [
      member({
        currentRank: 'General',
        qualifyingMonthsAtRank: 12,
        heldRankSince: new Date('2026-01-01T00:00:00Z'),
        joinedServerAt: new Date('2026-06-01T00:00:00Z'), // three months by the run date
      }),
    ];

    const engine = new PromotionEngine(store);
    const report = await engine.run({ now: new Date('2026-09-01T00:00:00Z'), dryRun: true });

    expect(report.wouldPromote, 'General → Lord General is a 9-month rank').toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/discord server/i);
  });

  it('★ MANDATORY: time at the RANK is checked as well as time in the server ★', async () => {
    /*
     * The gap the qualifying-month count leaves open: a member granted Cadet on the 28th who is
     * active for four days banks a whole qualifying month, because the rollup is keyed on the month
     * rather than on their grant. Long-standing in the server, and still not a month at the rank.
     */
    const store = new FakeStore();
    store.rows = [
      member({
        qualifyingMonthsAtRank: 1,
        heldRankSince: new Date('2026-08-28T00:00:00Z'),
        joinedServerAt: new Date('2020-01-01T00:00:00Z'),
      }),
    ];

    const engine = new PromotionEngine(store);
    const report = await engine.run({ now: new Date('2026-09-02T00:00:00Z'), dryRun: true });

    expect(report.wouldPromote).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/Held Cadet since 2026-08-28/);
  });
});
