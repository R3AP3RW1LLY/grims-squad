/**
 * "What can I do tonight?" — ranking open builds against the member reading the board.
 *
 * ★ SQUADRON OWNER, 2026-08-10 ★
 *
 * Chosen from the colonisation suggestions: match a member against every open project, sort the
 * boards by what actually matters, and say when a build has stalled.
 *
 * ★ THE PROBLEM ★
 *
 * The boards list projects in the order they were posted. A member with an evening free reads
 * nineteen rows, and the one 8 ly away needing 400 t looks exactly like the one 900 ly away needing
 * a quarter of a million. The information to tell them apart is all present and none of it is used.
 *
 * ★ IT SCORES, AND IT SHOWS ITS WORKING ★
 *
 * Every point awarded carries the sentence that earned it. A single opaque number that silently
 * reorders somebody's evening is not a tool they can argue with — and a member who cannot see why
 * a build is top of their list will either follow it blindly or ignore it entirely, and both are
 * worse than a plain alphabetical list they understand.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT KNOW ★
 *
 * What is in the member's hold. The hub stores no per-member cargo — the companion's cargo fold is
 * a local witness of what it watched move, and shipping it to the server for this would be new
 * ingestion for a question that is already 80% answered by position and urgency. The companion can
 * filter this list against its own hold locally; the website ranks without it and says so rather
 * than pretending.
 */

/** A build as this ranking needs to see it. Deliberately narrower than the board's own row. */
export interface OpportunityInput {
  readonly id: string;
  readonly title: string;
  readonly systemName: string;
  readonly owner: 'squadron' | 'personal';
  /** The squadron flagged it. An officer's decision about what matters, and it outranks geometry. */
  readonly isPriority: boolean;
  /** Tonnes still wanted. Zero means finished, and finished builds are not offered. */
  readonly remaining: number;
  /** The site's total ask. Zero when nobody has docked there yet, which makes a share meaningless. */
  readonly required: number;
  /** Galactic coordinates of the build's system. Null when our galaxy table cannot place it. */
  readonly coords: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** When anybody last hauled to it. Null when nobody ever has — which is NOT the same as stalled. */
  readonly lastDeliveryAt: Date | null;
}

export interface Opportunity extends OpportunityInput {
  /** Light years from the member. Null when either end cannot be placed. */
  readonly distanceLy: number | null;
  /** How much of the build is done, 0–100. Null when the site has never reported a total. */
  readonly pctDone: number | null;
  readonly daysSinceDelivery: number | null;
  readonly stalled: boolean;
  readonly score: number;
  /** Why it scored what it scored, in the member's words. Highest-value reason first. */
  readonly reasons: readonly string[];
}

export interface Viewer {
  /** Where the member was last seen. Null disables the distance term rather than the feature. */
  readonly coords: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly now: number;
}

/**
 * How long a build can go untouched before it is worth saying so.
 *
 * A week: long enough that a quiet weekend does not raise a flag, short enough that a build nobody
 * has touched since the last one shipped gets noticed while it still matters. This is the one
 * signal the boards genuinely cannot show on their own — a stalled build looks exactly like a
 * healthy one, just with an older number beside it.
 */
export const STALE_DAYS = 7;

/** The share at which finishing beats starting. */
export const NEARLY_DONE = 0.9;

/** Under this much left, a single hauler can close it out in one run. */
const ONE_RUN_TONNES = 800;

/**
 * How far away stops mattering.
 *
 * Distance decays rather than stepping: the difference between 5 ly and 15 is an evening's
 * difference, and between 400 and 500 is none at all — both are "a trip you are planning, not one
 * you are taking tonight".
 */
const DISTANCE_HALF_LIFE_LY = 40;

function distanceBetween(
  a: { readonly x: number; readonly y: number; readonly z: number } | null,
  b: { readonly x: number; readonly y: number; readonly z: number } | null,
): number | null {
  if (a === null || b === null) return null;
  const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  return Number.isFinite(d) ? Math.round(d * 10) / 10 : null;
}

/**
 * The ranked list, best first.
 *
 * ★ EVERY TERM IS NAMED AND BOUNDED ★
 *
 * The weights are arguable and that is fine — what matters is that no single term can run away with
 * the ranking, and that each one appears in `reasons` when it fires. A member disagreeing with the
 * order can see exactly which judgement they are disagreeing with.
 */
export function rankOpportunities(
  projects: readonly OpportunityInput[],
  viewer: Viewer,
): readonly Opportunity[] {
  const scored: Opportunity[] = [];

  for (const p of projects) {
    // A build somebody has already finished hauling to wastes the one thing this exists to save.
    if (p.remaining <= 0) continue;

    const reasons: Array<{ points: number; text: string }> = [];
    const distanceLy = distanceBetween(viewer.coords, p.coords);
    const pctDone =
      p.required > 0 ? Math.round(((p.required - p.remaining) / p.required) * 100) : null;

    const days =
      p.lastDeliveryAt === null
        ? null
        : Math.floor((viewer.now - p.lastDeliveryAt.getTime()) / 86_400_000);
    // Never stalled when nobody has ever hauled to it — "nothing delivered in 9 days" about a
    // project posted an hour ago reads as a broken tracker, not as information.
    const stalled = days !== null && days >= STALE_DAYS;

    if (p.isPriority) {
      reasons.push({ points: 30, text: 'A squadron priority build' });
    }

    if (pctDone !== null && pctDone >= NEARLY_DONE * 100) {
      reasons.push({ points: 25, text: `${pctDone}% done — this one wants finishing` });
    }

    if (stalled && days !== null) {
      reasons.push({ points: 15, text: `Nothing delivered in ${days} days` });
    }

    if (distanceLy !== null) {
      // Bounded at 30 and decaying, so a very near build cannot outrank an officer's flag.
      const points = Math.round(30 * Math.exp(-distanceLy / DISTANCE_HALF_LIFE_LY));
      if (points > 0) {
        reasons.push({
          points,
          text: distanceLy < 1 ? 'In the system you are in' : `${distanceLy} ly from you`,
        });
      }
    }

    if (p.remaining <= ONE_RUN_TONNES) {
      reasons.push({
        points: 10,
        text: `Only ${p.remaining.toLocaleString()} t left — one run could close it`,
      });
    }

    reasons.sort((a, b) => b.points - a.points);

    scored.push({
      ...p,
      distanceLy,
      pctDone,
      daysSinceDelivery: days,
      stalled,
      score: reasons.reduce((n, r) => n + r.points, 0),
      reasons: reasons.map((r) => r.text),
    });
  }

  /*
   * Ties break on id, not on input order. Two builds that score the same must not swap places
   * between page loads — a list that reshuffles itself is one people stop trusting to have thought
   * about anything.
   */
  return scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)));
}
