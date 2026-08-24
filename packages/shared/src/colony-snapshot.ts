/**
 * Freezing a system so a change to it can be judged.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Use the camera to snapshot panels. This allows for easily comparing differences whilst making
 * changes to your system."
 *
 * The system summary answers "what is this system". It cannot answer "is what I just did an
 * improvement", because by the time the new number is on screen the old one is gone. A member
 * swapping a refinery for a starport currently has to write the seven figures on paper first.
 *
 * ★ NOT PERSISTED, AND THAT IS THE POINT ★
 *
 * A snapshot is scaffolding for one editing session — "before I started fiddling". Storing it would
 * make it a thing to manage: stale snapshots, whose snapshot, which one is current. It lives in the
 * page for as long as the page does, and taking a new one replaces it.
 */

import { EFFECT_KEYS, type BuildEffects, type SystemSummary } from './colony-system-summary.js';

/** The figures worth comparing. Deliberately a subset of the summary — the rest is not a measure. */
export interface Snapshot {
  readonly score: number;
  readonly effects: BuildEffects;
  readonly counted: number;
  readonly outstandingTonnes: number;
  /** Whole milliseconds, supplied by the caller. This module never reads a clock. */
  readonly takenAt: number;
}

export interface EffectDelta {
  readonly key: (typeof EFFECT_KEYS)[number];
  readonly before: number;
  readonly now: number;
  readonly change: number;
}

export interface SnapshotDiff {
  readonly score: { readonly before: number; readonly now: number; readonly change: number };
  readonly counted: { readonly before: number; readonly now: number; readonly change: number };
  readonly outstandingTonnes: {
    readonly before: number;
    readonly now: number;
    readonly change: number;
  };
  /** Only the measures that MOVED. See below. */
  readonly moved: readonly EffectDelta[];
  /** True when nothing at all differs — the caller says so rather than drawing an empty table. */
  readonly identical: boolean;
}

/** Freezes what matters out of a summary. */
export function takeSnapshot(summary: SystemSummary, takenAt: number): Snapshot {
  return {
    score: summary.score,
    effects: { ...summary.effects },
    counted: summary.counted,
    outstandingTonnes: summary.outstandingTonnes,
    takenAt,
  };
}

/** Rounded like the summary itself: these are sums of catalogue decimals. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * What changed since the snapshot.
 *
 * ★ ONLY THE MEASURES THAT MOVED ★
 *
 * Seven rows of "no change" would bury the one that did. A member takes a snapshot precisely
 * because they are about to change one or two things, and the answer they want is which — not a
 * table they have to scan for a non-zero.
 *
 * `identical` exists so the caller can say "nothing has changed" in words. An empty diff table and
 * a diff table nobody has generated look the same on screen, and only one of them means anything.
 */
export function diffSnapshot(before: Snapshot, now: SystemSummary): SnapshotDiff {
  const moved: EffectDelta[] = [];

  for (const key of EFFECT_KEYS) {
    const change = round(now.effects[key] - before.effects[key]);
    if (change !== 0) {
      moved.push({ key, before: before.effects[key], now: now.effects[key], change });
    }
  }

  const score = {
    before: before.score,
    now: now.score,
    change: round(now.score - before.score),
  };
  const counted = {
    before: before.counted,
    now: now.counted,
    change: now.counted - before.counted,
  };
  const outstandingTonnes = {
    before: before.outstandingTonnes,
    now: now.outstandingTonnes,
    change: now.outstandingTonnes - before.outstandingTonnes,
  };

  return {
    score,
    counted,
    outstandingTonnes,
    moved,
    identical:
      moved.length === 0 &&
      score.change === 0 &&
      counted.change === 0 &&
      outstandingTonnes.change === 0,
  };
}

/**
 * A signed number for display, with the sign always shown.
 *
 * An unsigned "2" beside a before and an after reads as a value; "+2" reads as the change, which is
 * the only thing this column is for.
 */
export function signedChange(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * How long ago the snapshot was taken, in words.
 *
 * ★ WHY IT MATTERS ON A THING THAT IS NOT PERSISTED ★
 *
 * A snapshot taken twenty minutes and six edits ago is no longer "before I started fiddling" — it
 * is an arbitrary point somebody has lost track of. Saying its age lets a member notice that and
 * take a fresh one.
 */
export function snapshotAge(takenAt: number, now: number): string {
  const seconds = Math.floor((now - takenAt) / 1000);

  /*
   * No clamp on the negative side, and that is deliberate rather than an oversight: clock skew
   * gives a negative, which falls into this branch and reads "just now" — exactly right for a
   * snapshot taken a moment ago.
   *
   * A `Math.max(0, …)` was here first and no mutation could kill it, because it changed nothing.
   * Code no test can justify is decoration, and decoration in a date helper is where the next
   * person's wrong assumption goes.
   */
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
