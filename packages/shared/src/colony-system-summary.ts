/**
 * What a planned system adds up to, in one panel.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "we would like our planning and scouting and all colonization pages to look like this please but
 * keep our brand, theme and styling ... we want our colonization module to meet and exceed what
 * raven colonial offers"
 *
 * Every number here is already in the plan — the seven effects come down per build type and nothing
 * has ever added them up. A member could see what one refinery does and never what their whole
 * system does.
 *
 * ★ THE SCORE IS OURS, AND SAYS SO ★
 *
 * Raven shows a "System Score". Its formula is not published and was not reverse-engineered here, so
 * this does not pretend to reproduce it — a number that looked like theirs and disagreed would be
 * worse than no number, because a member would trust it and plan against it.
 *
 * `score` is the sum of the seven effects, which is explainable in one sentence and derived entirely
 * from the catalogue. Callers must label it as this platform's own figure.
 */

/** The seven scalars a build contributes, as the catalogue records them. */
export interface BuildEffects {
  readonly population: number;
  readonly maxPopulation: number;
  readonly security: number;
  readonly technology: number;
  readonly wealth: number;
  readonly standardOfLiving: number;
  readonly development: number;
}

export interface SummarySite {
  /** Null when the site has no build chosen yet — it contributes nothing. */
  readonly effects: BuildEffects | null;
  readonly totalTonnes: number | null;
  readonly built: boolean;
}

export interface UnknownSlotBody {
  readonly bodyId: number;
  /** Short label for the chip, e.g. "A 2 a". */
  readonly name: string;
}

export interface SystemSummary {
  readonly effects: BuildEffects;
  /** Our own composite: the seven effects added together. Never presented as Raven's. */
  readonly score: number;
  /** Sites counted — chosen builds only, since an empty site contributes nothing. */
  readonly counted: number;
  /** Tonnage still to deliver. Excludes anything already built. */
  readonly outstandingTonnes: number;
  /** Everything the system will have hauled when finished, built included. */
  readonly totalTonnes: number;
  readonly unknownSlots: readonly UnknownSlotBody[];
}

const ZERO: BuildEffects = {
  population: 0,
  maxPopulation: 0,
  security: 0,
  technology: 0,
  wealth: 0,
  standardOfLiving: 0,
  development: 0,
};

/** The seven keys, in the order the panel reads them. Exported so the UI cannot invent an eighth. */
export const EFFECT_KEYS = [
  'population',
  'maxPopulation',
  'security',
  'technology',
  'wealth',
  'standardOfLiving',
  'development',
] as const;

export type EffectKey = (typeof EFFECT_KEYS)[number];

/** Human labels, so the website and the app cannot word them differently. */
export const EFFECT_LABELS: Record<EffectKey, string> = {
  population: 'Population',
  maxPopulation: 'Max population',
  security: 'Security',
  technology: 'Tech level',
  wealth: 'Wealth',
  standardOfLiving: 'Standard of living',
  development: 'Development level',
};

/**
 * Adds a plan up.
 *
 * ★ UNCHOSEN SITES CONTRIBUTE NOTHING, AND ARE NOT COUNTED ★
 *
 * A plan being filled in is mostly empty rows. Counting them would make `counted` a measure of how
 * much typing somebody has done rather than what the system will be.
 *
 * ★ BUILT SITES STILL COUNT TOWARD THE EFFECTS ★
 *
 * They are the ones that definitely count — they exist. They are excluded only from OUTSTANDING
 * tonnage, which is about work remaining rather than about what the system is.
 */
export function summariseSystem(
  sites: readonly SummarySite[],
  unknownSlots: readonly UnknownSlotBody[] = [],
): SystemSummary {
  const effects = { ...ZERO };
  let counted = 0;
  let outstandingTonnes = 0;
  let totalTonnes = 0;

  for (const site of sites) {
    if (site.totalTonnes !== null) {
      totalTonnes += site.totalTonnes;
      if (!site.built) outstandingTonnes += site.totalTonnes;
    }

    if (site.effects === null) continue;
    counted += 1;
    for (const key of EFFECT_KEYS) effects[key] += site.effects[key];
  }

  /*
   * Rounded to two places. These are sums of decimals from the catalogue and a raw float renders as
   * 14.850000000000001, which reads as precision nobody has.
   */
  for (const key of EFFECT_KEYS) effects[key] = Math.round(effects[key] * 100) / 100;

  const score = Math.round(EFFECT_KEYS.reduce((sum, key) => sum + effects[key], 0) * 100) / 100;

  return { effects, score, counted, outstandingTonnes, totalTonnes, unknownSlots };
}

/**
 * How long a bar to draw for one effect, against the biggest in the set.
 *
 * ★ RELATIVE, BECAUSE THE SCALARS HAVE NO CEILING ★
 *
 * Development can reach +16 while security sits at +4, and there is no published maximum for any of
 * them. A bar scaled to an invented maximum would be a claim about the game; scaled to the largest
 * value present it is only a claim about this system, which is all the panel is for.
 *
 * Zero when everything is zero — an empty plan draws no bars rather than seven full ones.
 */
export function effectBar(value: number, all: BuildEffects): number {
  const peak = Math.max(...EFFECT_KEYS.map((k) => Math.abs(all[k])));
  if (peak === 0) return 0;
  return Math.max(0, Math.min(1, Math.abs(value) / peak));
}

/**
 * "32 bodies with unknown slot counts", or null when every body is known.
 *
 * The owner's screenshot shows this as the system's headline caveat, and it is the right one: every
 * slot warning below it is only as good as the counts nobody has entered.
 */
export function unknownSlotsNote(bodies: readonly UnknownSlotBody[]): string | null {
  if (bodies.length === 0) return null;
  const n = bodies.length;
  return `${n} ${n === 1 ? 'body has' : 'bodies have'} no recorded slot counts — open the system in the game’s architect view to fill them in.`;
}
