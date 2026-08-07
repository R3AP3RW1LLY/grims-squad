/**
 * What the refinery has finished this session, and what it is worth on the board.
 *
 * ★ SCORED ON REFINING, NOT ON SELLING ★
 *
 * `MiningRefined` fires when the refinery completes a tonne — the moment the work happened. Selling
 * is a different skill with its own board, and paying twice for one tonne would let a miner farm
 * both with a single action.
 *
 * ★ THE POINTS SHOWN HERE ARE THE POINTS THAT LAND ★
 *
 * Computed with the same `miningPoints` the hub scores with, from the same shared weights. A panel
 * that estimated its own number would eventually disagree with the leaderboard — and the member
 * watching it all evening would be right to trust the panel and wrong about their score.
 */

import { miningPoints } from '@grims/shared';

export interface RefiningState {
  /** Total tonnes this session. */
  readonly tonnes: number;
  /** Tonnes per material, for the bars. */
  readonly byMaterial: Readonly<Record<string, number>>;
  /** Deep Core points, by the hub's own arithmetic. */
  readonly points: number;
  /** When the FIRST tonne landed. Null until one does — see the note in the fold. */
  readonly startedAt: number | null;
  /** When the most recent tonne landed, so a paused session can be told from a busy one. */
  readonly lastAt: number | null;
}

export const EMPTY_REFINING: RefiningState = {
  tonnes: 0,
  byMaterial: {},
  points: 0,
  startedAt: null,
  lastAt: null,
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Fold one `MiningRefined` into the session.
 *
 * @param at when the event happened, in epoch milliseconds.
 */
export function foldRefining(
  state: RefiningState,
  payload: unknown,
  at: number,
): RefiningState {
  if (typeof payload !== 'object' || payload === null) return state;
  const p = payload as Record<string, unknown>;

  /*
   * Frontier ships some commodities with no `Type_Localised`, so the internal symbol is the
   * fallback rather than a reason to drop the tonne — losing whole materials from a session with
   * no pattern the member could see is worse than an ugly name on one bar.
   */
  const material = str(p['Type_Localised']) ?? str(p['Type']);

  /*
   * An event naming nothing is ignored rather than counted under a blank key: that would put an
   * unnamed bar on the panel and add tonnes nobody mined. Nothing is lost — an event that does not
   * say what was refined cannot be scored either.
   */
  if (material === null) return state;

  /*
   * ★ ONE EVENT IS ONE TONNE ★
   *
   * `MiningRefined` carries no quantity; it fires once per completed tonne. Reading a count off it
   * would be inventing one.
   */
  return {
    tonnes: state.tonnes + 1,
    byMaterial: { ...state.byMaterial, [material]: (state.byMaterial[material] ?? 0) + 1 },
    points: state.points + miningPoints(material, 1),
    /*
     * The clock starts at the FIRST TONNE, not when the app opened. An app left running since
     * breakfast would otherwise divide an evening's tonnage by nine hours and report a rate a
     * tenth of the truth.
     */
    startedAt: state.startedAt ?? at,
    lastAt: at,
  };
}

/** Minutes of actual session, or null before the first tonne. */
export function sessionMinutes(state: RefiningState, now: number): number | null {
  if (state.startedAt === null) return null;
  return Math.max(0, (now - state.startedAt) / 60_000);
}

/**
 * Tonnes per hour.
 *
 * Null before the first tonne rather than zero: "0 t/h" reads as "you are mining badly", where
 * nothing yet is the truth and the panel can draw a dash.
 */
export function refinedRate(state: RefiningState, now: number): number | null {
  const minutes = sessionMinutes(state, now);
  if (minutes === null) return null;

  /*
   * ★ NEVER DIVIDED BY ZERO ★
   *
   * The first tonne arrives at exactly `startedAt`, so a naive divide gives Infinity — which
   * renders as "Infinity t/h" on a panel somebody is reading at a glance. One second is the floor:
   * the first tonne's rate is meaningless either way, and a large finite number is at least
   * something a member can ignore.
   */
  const hours = Math.max(minutes, 1 / 60) / 60;
  return state.tonnes / hours;
}
