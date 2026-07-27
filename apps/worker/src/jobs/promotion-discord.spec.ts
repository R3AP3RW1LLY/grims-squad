import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromotionEngine,
  type PromotionStore,
  type MemberStanding,
  type LadderRung,
  type RankApplier,
} from './promotion-run.js';

/**
 * The promotion ↔ reconciliation interaction.
 *
 * ★ THE BUG THIS FILE EXISTS TO PREVENT ★
 *
 * Ladder ranks are now MAPPED to Discord roles, so reconciliation learns each
 * member's current rank from the guild. That bootstrap is what stops 108 people
 * being entered by hand — but it creates a loop if promotion only writes to our
 * own database:
 *
 *   1. Engine grants Sergeant here (source `system`) and removes Cadet.
 *   2. Discord still says Cadet.
 *   3. Reconciliation sees Cadet in Discord, sees no `discord`-sourced grant,
 *      and grants Cadet back.
 *   4. The member now holds Cadet AND Sergeant — which violates `single_rank`
 *      in ssot/02-domain/rank-progression.yaml.
 *
 * Nothing errors. The member simply accumulates ranks, and the hierarchy stops
 * meaning anything at a glance — exactly what `single_rank` was written to
 * prevent. So a promotion has to change DISCORD as well, and Discord stays the
 * thing reconciliation can safely trust.
 */

const LADDER: LadderRung[] = [
  { rank: 'Cadet', qualifyingMonthsRequired: 1, next: 'Sergeant' },
  { rank: 'Sergeant', qualifyingMonthsRequired: 1, next: 'Master Sergeant' },
  { rank: 'Master Sergeant', qualifyingMonthsRequired: null, next: null },
];

const AFTER_FLOOR = new Date('2026-08-01T00:00:00.000Z');

class FakeStore implements PromotionStore {
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

class FakeApplier implements RankApplier {
  calls: Array<{ userId: string; from: string; to: string }> = [];
  failOn: string | null = null;

  async applyRank(userId: string, from: string, to: string): Promise<void> {
    if (this.failOn === userId) throw new Error('Discord refused the role change');
    this.calls.push({ userId, from, to });
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
let applier: FakeApplier;
let engine: PromotionEngine;

beforeEach(() => {
  store = new FakeStore();
  applier = new FakeApplier();
  engine = new PromotionEngine(store, applier);
});

describe('a live promotion changes Discord too', () => {
  it('MANDATORY: pushes the rank change to Discord, not only to our database', async () => {
    store.rows = [member()];
    await engine.run({ now: AFTER_FLOOR, dryRun: false });

    expect(applier.calls).toEqual([{ userId: 'u1', from: 'Cadet', to: 'Sergeant' }]);
  });

  it('MANDATORY: a DRY RUN touches Discord not at all', async () => {
    // A rehearsal that changes someone's Discord role is not a rehearsal, and
    // it is visible to the whole server the moment it happens.
    store.rows = [member()];
    await engine.run({ now: AFTER_FLOOR, dryRun: true });

    expect(applier.calls).toEqual([]);
    expect(store.applied).toEqual([]);
  });

  it('MANDATORY: our database is NOT updated when Discord refuses', async () => {
    /*
     * Order matters. Discord goes FIRST, and our row follows only if it worked.
     *
     * The other order leaves the exact drift this whole file is about: our
     * database says Sergeant, Discord says Cadet, and the next reconciliation
     * hands Cadet back. Failing loudly with both sides unchanged is recoverable
     * — the next run simply tries again.
     */
    applier.failOn = 'u1';
    store.rows = [member()];

    const report = await engine.run({ now: AFTER_FLOOR, dryRun: false });

    expect(store.applied).toEqual([]);
    expect(store.audit).toEqual([]);
    expect(report.promoted).toBe(0);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.reason).toMatch(/discord/i);
  });

  it('one member failing does not stop the others', async () => {
    applier.failOn = 'u1';
    store.rows = [member({ userId: 'u1' }), member({ userId: 'u2', handle: 'ava' })];

    const report = await engine.run({ now: AFTER_FLOOR, dryRun: false });

    expect(report.promoted).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(store.applied).toEqual([{ userId: 'u2', from: 'Cadet', to: 'Sergeant' }]);
  });

  it('still works with no applier configured, and says so', async () => {
    // The engine must remain runnable without Discord wired up — that is how
    // every dry run before August is done. But a LIVE run without an applier
    // would create precisely the drift above, so it refuses.
    const bare = new PromotionEngine(store);
    store.rows = [member()];

    await expect(bare.run({ now: AFTER_FLOOR, dryRun: false })).rejects.toThrow(/discord/i);
    await expect(bare.run({ now: AFTER_FLOOR, dryRun: true })).resolves.toBeDefined();
  });
});
