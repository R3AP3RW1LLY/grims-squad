/**
 * Reading a prospected rock, and keeping score across a session.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... must meet / exceed ED tools as it works currently!"
 *
 * ★ THE TWO-SECOND DECISION ★
 *
 * A prospected rock drifts past in a couple of seconds, and the whole skill of laser mining is
 * deciding inside that window whether it is worth the time. Everything here exists to make that
 * decision instantly readable: the best material first, its share, and whether it beats the bar the
 * member set for that specific material.
 *
 * Pure, and deliberately separate from the overlay that draws it. A fold that can only be exercised
 * by launching Electron and flying to a ring is a fold nobody will ever test again.
 */

import { worthShooting, type ProspectThresholds, type Rock } from '@grims/shared';

/*
 * `readRock` and its types moved to @grims/shared once the worker needed to read the same payload
 * on ingest. Re-exported here so every existing importer — and the fifteen tests below it — keep
 * working against the same names.
 */
export { readRock } from '@grims/shared';
export type { Rock, RockMaterial } from '@grims/shared';

export interface ProspectingState {
  /** The rock on screen. Survives a barren one — see the fold. */
  readonly current: Rock | null;
  /** Whether `current` beat the member's bar. False after a barren rock. */
  readonly currentIsHit: boolean;
  /** Every rock a limpet reported, including the barren ones. */
  readonly prospected: number;
  /** How many were worth shooting. `hits / prospected` is the number that says stay or move. */
  readonly hits: number;
  readonly motherlodes: number;
  readonly bestPercent: number;
  readonly bestMaterial: string | null;
}

export const EMPTY_PROSPECTING: ProspectingState = {
  current: null,
  currentIsHit: false,
  prospected: 0,
  hits: 0,
  motherlodes: 0,
  bestPercent: 0,
  bestMaterial: null,
};

/**
 * Fold one prospected rock into the session.
 *
 * @param rock the result of `readRock`, or null for a barren one.
 */
export function foldProspecting(
  state: ProspectingState,
  rock: Rock | null,
  thresholds: ProspectThresholds,
): ProspectingState {
  /*
   * ★ A BARREN ROCK STILL COUNTS ★
   *
   * It cost a limpet and it is evidence about the ring. Counting only the good ones would make the
   * hit rate meaningless — it would always be 100%, which is the one value that says nothing.
   */
  if (rock === null) {
    return {
      ...state,
      prospected: state.prospected + 1,
      /*
       * The last good rock STAYS on screen. Clearing it would make the panel flicker to empty on
       * every miss, which in a poor ring is most of them — and a panel that spends its time blank
       * is one nobody looks at. Only `currentIsHit` drops, so nothing is highlighted that should
       * not be.
       */
      currentIsHit: false,
    };
  }

  const isHit = worthShooting(rock.top.name, rock.top.percent, thresholds);
  const better = rock.top.percent > state.bestPercent;

  return {
    current: rock,
    currentIsHit: isHit,
    prospected: state.prospected + 1,
    hits: state.hits + (isHit ? 1 : 0),
    motherlodes: state.motherlodes + (rock.motherlode === null ? 0 : 1),
    bestPercent: better ? rock.top.percent : state.bestPercent,
    bestMaterial: better ? rock.top.name : state.bestMaterial,
  };
}

/** Hit rate as a percentage, or null before any rock — a rate over zero rocks is not zero. */
export function hitRate(state: ProspectingState): number | null {
  if (state.prospected === 0) return null;
  return (state.hits / state.prospected) * 100;
}
