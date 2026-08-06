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

import { worthShooting, type ProspectThresholds } from '@grims/shared';

export interface RockMaterial {
  readonly name: string;
  /** Percentage of the rock, as the game reports it. */
  readonly percent: number;
}

export interface Rock {
  /** Every material, richest first — see `readRock`. */
  readonly materials: readonly RockMaterial[];
  /** The richest one. Never null: a rock with no materials is not a Rock at all. */
  readonly top: RockMaterial;
  /** The rock a core miner is hunting, when there is one. */
  readonly motherlode: string | null;
  /** Frontier's own word for overall richness: Low, Medium, High. */
  readonly content: string | null;
  /** How much is left, for a rock somebody else has already been at. */
  readonly remaining: number | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Frontier's display name where it exists, the internal symbol cleaned up otherwise. */
function materialName(raw: Record<string, unknown>): string | null {
  return str(raw['Name_Localised']) ?? str(raw['Name']);
}

/**
 * One `ProspectedAsteroid` payload, read into something a panel can draw.
 *
 * Returns null for a rock with nothing usable on it. That is not an error — a prospector limpet on
 * a barren rock has genuinely told the member something — but an overlay drawing an empty list
 * looks broken, so the caller keeps showing the last real rock and only moves the counters.
 */
export function readRock(payload: unknown): Rock | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const raw = p['Materials'];
  if (!Array.isArray(raw)) return null;

  const materials: RockMaterial[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;

    const name = materialName(item);
    const percent = item['Proportion'];
    /*
     * A non-numeric proportion is dropped rather than coerced. `Number('lots')` is NaN, which
     * renders as "NaN%" on a panel somebody is reading at a glance and sorts unpredictably against
     * real numbers — one bad field would scramble the whole list.
     */
    if (name === null || typeof percent !== 'number' || !Number.isFinite(percent)) continue;

    materials.push({ name, percent });
  }

  if (materials.length === 0) return null;

  /*
   * ★ SORTED, BECAUSE FRONTIER DOES NOT ★
   *
   * The journal lists materials in its own order. A panel showing that order would put 4%
   * Bertrandite above 38% Painite — the exact opposite of the decision being made in the two
   * seconds the rock is on screen.
   */
  materials.sort((a, b) => b.percent - a.percent);

  return {
    materials,
    // Safe: the length check above guarantees one.
    top: materials[0] as RockMaterial,
    motherlode: str(p['MotherlodeMaterial_Localised']) ?? str(p['MotherlodeMaterial']),
    content: str(p['Content_Localised']) ?? str(p['Content']),
    remaining: typeof p['Remaining'] === 'number' ? p['Remaining'] : null,
  };
}

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
