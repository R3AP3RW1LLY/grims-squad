import { describe, expect, it } from 'vitest';
import { diffSnapshot, signedChange, snapshotAge, takeSnapshot } from './colony-snapshot.js';
import { summariseSystem, type BuildEffects } from './colony-system-summary.js';

/**
 * Judging a change to a system.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Use the camera to snapshot panels. This allows for easily comparing differences whilst making
 * changes to your system."
 *
 * The summary answers "what is this system". It cannot answer "was that an improvement", because by
 * the time the new number is on screen the old one is gone — a member swapping a refinery for a
 * starport has to write seven figures on paper first.
 */

const fx = (over: Partial<BuildEffects> = {}): BuildEffects => ({
  population: 0,
  maxPopulation: 0,
  security: 0,
  technology: 0,
  wealth: 0,
  standardOfLiving: 0,
  development: 0,
  ...over,
});

const system = (effects: BuildEffects, tonnes = 0) =>
  summariseSystem([{ effects, totalTonnes: tonnes, built: false }]);

describe('taking a snapshot', () => {
  it('freezes the figures, not a reference to them', () => {
    /*
     * The summary is recomputed on every render. A snapshot holding a reference would change
     * underneath the comparison and always report "no difference" — the one answer it must never
     * give wrongly.
     */
    const summary = system(fx({ wealth: 5 }));
    const snap = takeSnapshot(summary, 1_000);

    // Mutating the source must not reach the snapshot.
    (summary.effects as { wealth: number }).wealth = 99;

    expect(snap.effects.wealth).toBe(5);
  });

  it('never reads a clock of its own', () => {
    // The caller supplies the time. A module that reads Date.now() cannot be tested at a fixed one.
    expect(takeSnapshot(system(fx()), 12_345).takenAt).toBe(12_345);
  });
});

describe('comparing against a snapshot', () => {
  it('★ MANDATORY: reports ONLY the measures that moved ★', () => {
    /*
     * Seven rows of "no change" would bury the one that did. A member takes a snapshot precisely
     * because they are about to change one or two things, and the answer they want is which.
     */
    const before = takeSnapshot(system(fx({ wealth: 5, security: 2 })), 0);
    const diff = diffSnapshot(before, system(fx({ wealth: 9, security: 2 })));

    expect(diff.moved.map((m) => m.key)).toEqual(['wealth']);
    expect(diff.moved[0]).toMatchObject({ before: 5, now: 9, change: 4 });
  });

  it('★ MANDATORY: says plainly when nothing has changed ★', () => {
    /*
     * An empty diff table and a diff table nobody generated look identical on screen, and only one
     * of them means anything. The caller needs to be able to say it in words.
     */
    const summary = system(fx({ wealth: 5 }));
    const diff = diffSnapshot(takeSnapshot(summary, 0), summary);

    expect(diff.identical).toBe(true);
    expect(diff.moved).toEqual([]);
  });

  it('a change in tonnage alone is not "identical"', () => {
    // Swapping one build for another of equal effect still changes what has to be hauled.
    const before = takeSnapshot(system(fx({ wealth: 5 }), 1_000), 0);
    const diff = diffSnapshot(before, system(fx({ wealth: 5 }), 4_000));

    expect(diff.identical).toBe(false);
    expect(diff.outstandingTonnes.change).toBe(3_000);
  });

  it('reports a build being removed as a negative change', () => {
    const before = takeSnapshot(system(fx({ development: 8 })), 0);
    const diff = diffSnapshot(before, summariseSystem([]));

    expect(diff.counted.change).toBe(-1);
    expect(diff.moved[0]).toMatchObject({ key: 'development', change: -8 });
  });

  it('does not render floating-point noise in the change', () => {
    // Catalogue decimals: 14.85 - 4.95 must read as 9.9, not 9.900000000000002.
    const before = takeSnapshot(system(fx({ wealth: 4.95 })), 0);
    const diff = diffSnapshot(before, system(fx({ wealth: 14.85 })));

    expect(diff.moved[0]?.change).toBe(9.9);
  });
});

describe('showing a change', () => {
  it('always shows the sign, because the column is about direction', () => {
    expect(signedChange(4)).toBe('+4');
    expect(signedChange(-4)).toBe('-4');
    // Zero never reaches the display — `moved` excludes it — but must not read as "+0" if it does.
    expect(signedChange(0)).toBe('0');
  });
});

describe('how old the snapshot is', () => {
  it('★ MANDATORY: says its age, so a stale one can be noticed ★', () => {
    /*
     * A snapshot taken twenty minutes and six edits ago is no longer "before I started fiddling" —
     * it is an arbitrary point somebody has lost track of.
     */
    expect(snapshotAge(0, 30_000)).toBe('just now');
    expect(snapshotAge(0, 60_000)).toBe('1 minute ago');
    expect(snapshotAge(0, 20 * 60_000)).toBe('20 minutes ago');
    expect(snapshotAge(0, 60 * 60_000)).toBe('1 hour ago');
    expect(snapshotAge(0, 3 * 60 * 60_000)).toBe('3 hours ago');
  });

  it('★ MANDATORY: clock skew never produces "-2 minutes ago" ★', () => {
    /*
     * A negative falls into the under-a-minute branch and reads "just now", which is right for a
     * snapshot taken a moment ago. Guarded on the OUTPUT rather than on a clamp: an explicit
     * Math.max was here first and no mutation could kill it, because it changed nothing.
     */
    expect(snapshotAge(10_000, 0)).toBe('just now');
    expect(snapshotAge(3_600_000, 0), 'even a large skew').toBe('just now');
    expect(snapshotAge(3_600_000, 0)).not.toContain('-');
  });
});
