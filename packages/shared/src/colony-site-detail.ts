/**
 * Everything worth knowing about ONE site, gathered in one place.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "Pin a site to see details about it. This will update in real time as you make changes."
 *
 * The facts are all on the plan already — the catalogue knows what a build costs and does, the
 * simulation knows what is banked by the time it is reached, the body knows how many slots were
 * recorded. They have never been assembled for a single site, so choosing between two builds meant
 * reading four places and holding the difference in your head.
 *
 * ★ IT ANSWERS "CAN I, AND SHOULD I" ★
 *
 * Two different questions and both belong here. `affordable` is the first: does the order bank
 * enough tier points by the time this site is reached. The effects are the second: what the system
 * gets for it. A panel that answered only one would send somebody to the other three places anyway.
 */

import type { BuildEffects } from './colony-system-summary.js';

export interface SiteDetailInput {
  /** Null when no build has been chosen — the ordinary state of a plan being filled in. */
  readonly buildTypeId: string | null;
  readonly buildTypeName: string | null;
  readonly tier: number | null;
  readonly totalTonnes: number | null;
  readonly location: 'orbital' | 'surface';
  readonly effects: BuildEffects | null;
  /** What this build spends, from the catalogue. */
  readonly needsTier: number;
  readonly needsPoints: number;
  /** What the order has banked by the time this site is reached. */
  readonly bankedTier2: number;
  readonly bankedTier3: number;
  /** What this feeds into the port that receives it. Null when it feeds nothing. */
  readonly economyInfluence: string | null;
  /** The system's first station: the game charges nothing for it. */
  readonly isPrimary: boolean;
}

export interface SiteDetail {
  readonly hasBuild: boolean;
  /** Tier points this build spends, and whether they are there. */
  readonly cost: { readonly tier: number; readonly points: number; readonly banked: number } | null;
  readonly affordable: boolean;
  readonly effects: BuildEffects | null;
  /** Every reason this site is worth a second look, worst first. */
  readonly notes: readonly string[];
}

/**
 * What to show for the pinned site.
 *
 * ★ NOTES ARE ORDERED BY WHAT WOULD STOP YOU ★
 *
 * A site that cannot be paid for is a different problem from one that contributes nothing, and both
 * are different from one that has not been chosen. Ordered worst-first for the same reason the
 * orphan flags are: an officer reads the first line.
 */
export function siteDetail(input: SiteDetailInput): SiteDetail {
  const notes: string[] = [];

  if (input.buildTypeId === null) {
    return {
      hasBuild: false,
      cost: null,
      affordable: true,
      effects: null,
      // Not a fault. Most rows in a plan being written look exactly like this.
      notes: ['No build chosen yet — pick one to see what it costs and what it does.'],
    };
  }

  /*
   * ★ THE FIRST STATION IS FREE, AND SAYING SO MATTERS ★
   *
   * The game charges nothing for a system's first station. Showing a tier cost against it would
   * have somebody bank points they never needed, and then wonder why the arithmetic never matches
   * the game.
   */
  const spends = input.needsPoints > 0 && !input.isPrimary;
  const banked = input.needsTier >= 3 ? input.bankedTier3 : input.bankedTier2;
  const cost = spends ? { tier: input.needsTier, points: input.needsPoints, banked } : null;
  const affordable = !spends || banked >= input.needsPoints;

  if (input.isPrimary) {
    notes.push('The system’s first station — the game charges no tier points for it.');
  }

  if (!affordable && cost !== null) {
    /*
     * "only 0 are banked" is clumsy where it matters most — the case where nothing has been banked
     * at all is the one somebody most needs to read cleanly.
     */
    const have =
      cost.banked === 0
        ? 'none are banked'
        : `only ${cost.banked} ${cost.banked === 1 ? 'is' : 'are'} banked`;

    notes.push(
      `Needs ${cost.points} tier-${cost.tier} point${cost.points === 1 ? '' : 's'}, but ${have} ` +
        `by the time this is reached. ` +
        `Build something that gives tier-${cost.tier} points earlier in the order.`,
    );
  }

  /*
   * An effectless build is worth flagging: it is almost always a placeholder somebody meant to come
   * back to, and it contributes nothing to the system summary above.
   */
  const contributes =
    input.effects !== null &&
    (input.effects.population !== 0 ||
      input.effects.maxPopulation !== 0 ||
      input.effects.security !== 0 ||
      input.effects.technology !== 0 ||
      input.effects.wealth !== 0 ||
      input.effects.standardOfLiving !== 0 ||
      input.effects.development !== 0);

  if (input.effects !== null && !contributes) {
    notes.push('This build changes none of the system’s seven measures.');
  }

  if (input.economyInfluence !== null && input.economyInfluence !== 'none') {
    notes.push(`Feeds ${input.economyInfluence} into the port that receives it.`);
  }

  return { hasBuild: true, cost, affordable, effects: input.effects, notes };
}
