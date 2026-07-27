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

const LADDER: LadderRung[] = [
  { rank: 'Cadet', qualifyingMonthsRequired: 1, next: 'Sergeant' },
  { rank: 'Sergeant', qualifyingMonthsRequired: 1, next: 'Master Sergeant' },
  { rank: 'Master Sergeant', qualifyingMonthsRequired: 1, next: '2nd Lieutenant' },
  { rank: 'General', qualifyingMonthsRequired: 2, next: 'Lord General' },
  { rank: 'Lord General', qualifyingMonthsRequired: 3, next: 'Grand Master General' },
  { rank: 'Grand Master General', qualifyingMonthsRequired: null, next: null },
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
  ...over,
});

let store: FakeStore;
let engine: PromotionEngine;

beforeEach(() => {
  store = new FakeStore();
  engine = new PromotionEngine(store);
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
