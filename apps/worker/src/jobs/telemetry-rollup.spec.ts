import { describe, it, expect } from 'vitest';
import {
  liftBank,
  monthStart,
  rollUpTelemetry,
  type MonthBank,
  type TelemetryRollupStore,
  type TypeCount,
} from './telemetry-rollup.js';

/**
 * The month bank behind the per-month telemetry view.
 *
 * ★ WHAT THIS SUITE PROTECTS ★
 *
 * Raw telemetry is purged at thirty days, so a banked month is the ONLY copy of itself. What
 * matters is that the bank can never be made worse by the job that maintains it: a re-run must
 * correct rather than double, the purge must never claw a banked figure back down, and a month
 * the live window cannot see must never be touched at all.
 */

const AUG_10 = new Date('2026-08-10T14:03:00Z');
const AUG = new Date(Date.UTC(2026, 7, 1));
const JUL = new Date(Date.UTC(2026, 6, 1));

function harness(opts: {
  /** Live-window counts, keyed by the range start's ISO month. */
  live?: Record<string, MonthBank>;
  /** What the bank already holds, keyed the same way. */
  banked?: Record<string, MonthBank>;
}) {
  const written: Array<{ month: Date; data: MonthBank; prune: boolean }> = [];
  const key = (d: Date): string => d.toISOString().slice(0, 7);

  const store: TelemetryRollupStore = {
    countsFor: async (start) => opts.live?.[key(start)]?.counts ?? [],
    reportersFor: async (start) => opts.live?.[key(start)]?.reporters ?? 0,
    banked: async (month) => opts.banked?.[key(month)] ?? { reporters: 0, counts: [] },
    bank: async (month, data, o) => {
      written.push({ month, data, prune: o.prune });
    },
  };

  return {
    store,
    written,
    wrote: (month: Date) => written.find((w) => w.month.getTime() === month.getTime()),
  };
}

const counts = (data: MonthBank | undefined): Record<string, number> =>
  Object.fromEntries((data?.counts ?? []).map((c: TypeCount) => [c.eventType, c.count]));

describe('which months the sweep touches', () => {
  it('MANDATORY: banks exactly the current and previous month, and nothing older', async () => {
    /*
     * June is beyond the live window. Any write to it would come from rows the purge has
     * already thinned — the job must leave it exactly as banked, for ever.
     */
    const h = harness({
      live: { '2026-08': { reporters: 3, counts: [{ eventType: 'FSDJump', count: 40 }] } },
    });

    await rollUpTelemetry(h.store, AUG_10);

    expect(h.written.map((w) => w.month.toISOString().slice(0, 10)).sort()).toEqual([
      '2026-07-01',
      '2026-08-01',
    ]);
  });

  it('replaces the current month and only the current month whole', async () => {
    /*
     * `prune` follows the rule, not the call order: the current month is fully inside
     * retention, so its live window is the truth — including a member purging a category,
     * which must REMOVE the banked type. The previous month is part-purged, so pruning it
     * would delete exactly what the bank exists to keep.
     */
    const h = harness({});
    await rollUpTelemetry(h.store, AUG_10);

    expect(h.wrote(AUG)?.prune).toBe(true);
    expect(h.wrote(JUL)?.prune).toBe(false);
  });
});

describe('the lift — a banked month is only ever raised', () => {
  it('MANDATORY: keeps the banked count when the purge has eaten the live rows', () => {
    /*
     * On the 29th of August, the 1st of July is 59 days gone: the live window shows a fraction
     * of July. Replacing the bank with that fraction would overwrite the only complete figure
     * with a worse one — the exact failure this table exists to prevent.
     */
    const lifted = liftBank(
      { reporters: 9, counts: [{ eventType: 'FSDJump', count: 500 }] },
      { reporters: 2, counts: [{ eventType: 'FSDJump', count: 120 }] },
    );

    expect(counts(lifted)['FSDJump']).toBe(500);
    expect(lifted.reporters).toBe(9);
  });

  it('absorbs late-arriving journals while the month is still visible', () => {
    // A member who played offline uploads after the month turned. More events in the live
    // window than the bank holds means the bank was incomplete, and the larger figure wins.
    const lifted = liftBank(
      { reporters: 4, counts: [{ eventType: 'FSDJump', count: 500 }] },
      { reporters: 6, counts: [{ eventType: 'FSDJump', count: 620 }] },
    );

    expect(counts(lifted)['FSDJump']).toBe(620);
    expect(lifted.reporters).toBe(6);
  });

  it('keeps a banked type the live window no longer shows at all', () => {
    // Every Bounty row from early July is purged; the type simply stops appearing in the live
    // GROUP BY. Absence from a thinned window is not evidence of absence from the month.
    const lifted = liftBank(
      {
        reporters: 5,
        counts: [
          { eventType: 'Bounty', count: 80 },
          { eventType: 'FSDJump', count: 200 },
        ],
      },
      { reporters: 1, counts: [{ eventType: 'FSDJump', count: 40 }] },
    );

    expect(counts(lifted)).toEqual({ Bounty: 80, FSDJump: 200 });
  });

  it('admits a type the bank has never seen', () => {
    // First run after the table was created, or an event type new this month: the bank starts
    // from whatever is still visible rather than from nothing for ever.
    const lifted = liftBank(
      { reporters: 0, counts: [] },
      { reporters: 2, counts: [{ eventType: 'LoadGame', count: 15 }] },
    );

    expect(counts(lifted)).toEqual({ LoadGame: 15 });
    expect(lifted.reporters).toBe(2);
  });
});

describe('what the previous month is banked as', () => {
  it('writes the LIFTED figures, not the raw live ones', async () => {
    const h = harness({
      live: { '2026-07': { reporters: 2, counts: [{ eventType: 'FSDJump', count: 120 }] } },
      banked: { '2026-07': { reporters: 9, counts: [{ eventType: 'FSDJump', count: 500 }] } },
    });

    const report = await rollUpTelemetry(h.store, AUG_10);

    expect(counts(h.wrote(JUL)?.data)['FSDJump']).toBe(500);
    expect(h.wrote(JUL)?.data.reporters).toBe(9);
    expect(report.previousEvents).toBe(500);
  });
});

describe('the month key', () => {
  it('pins to the first of the month, midnight UTC', () => {
    // The same rule as the activity tables. Local time would file 23:30 on 31 July under
    // August for half the world.
    expect(monthStart(new Date('2026-07-31T23:30:00Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(monthStart(new Date('2026-08-01T00:00:01Z')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });
});
