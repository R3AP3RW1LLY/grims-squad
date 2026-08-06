/**
 * Mining: what a tonne is worth, and whether this rock is worth shooting.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... gamified leaderboard ... on refined materials ... must meet /
 * exceed ED tools as it works currently!"
 *
 * ★ WEIGHTED BY WHAT IT WAS, NOT BY WHAT IT SOLD FOR ★
 *
 * The obvious scale is credits, and it is wrong. Mineral prices move constantly, so a board scored
 * on value would rerank itself whenever the market shifted — and what somebody did in March is not
 * supposed to change in August. A leaderboard is a record, and a record that moves is a rumour.
 *
 * So a tonne is a tonne, multiplied by how hard that tonne was to come by. Core-only materials
 * cannot be laser-mined at all: every one is a rock found, charged, cracked and collected. Bauxite
 * falls out of a laser by accident.
 *
 * ★ SCORED ON REFINING, NOT ON SELLING ★
 *
 * `MiningRefined` fires when the refinery finishes a tonne — the moment the work happened. Selling
 * is a different skill and already has a board (Trade Barons); paying twice for one tonne would let
 * a miner farm both with a single action.
 */

/** The floor. An unknown mineral still scores — see `materialWeight`. */
export const DEFAULT_MINING_WEIGHT = 1;

/**
 * Materials that cannot be laser-mined.
 *
 * Exported because the badges and the UI both describe them as a group, and a second hand-written
 * list would drift from the weights below — a material called core-only in one place and scored
 * like gravel in another.
 */
export const CORE_ONLY_MATERIALS: readonly string[] = [
  'Void Opal',
  'Alexandrite',
  'Monazite',
  'Musgravite',
  'Grandidierite',
  'Rhodplumsite',
  'Serendibite',
  'Benitoite',
];

/**
 * How much a tonne of each mineral is worth in points.
 *
 * Keyed by a normalised name — see `normalise` — because the journal writes `Type` as an internal
 * symbol and `Type_Localised` as a display name, and which one arrives varies by commodity.
 */
export const MINING_WEIGHTS: Readonly<Record<string, number>> = {
  // ── Core-only: seismic charges, a specific ship, and actual skill. ────────────────── ×8
  voidopal: 8,
  alexandrite: 8,
  monazite: 8,
  musgravite: 8,
  grandidierite: 8,
  rhodplumsite: 8,
  serendibite: 8,
  benitoite: 8,

  // ── Laser premium: the classic grind, still deliberate work. ─────────────────────── ×4
  painite: 4,
  platinum: 4,
  lowtemperaturediamonds: 4,
  bromellite: 4,
  osmium: 4,

  // ── Laser common: volume mining. ─────────────────────────────────────────────────── ×2
  bertrandite: 2,
  indite: 2,
  gallite: 2,
  gold: 2,
  silver: 2,
  praseodymium: 2,
  samarium: 2,
  lithiumhydroxide: 2,
  methanolmonohydratecrystals: 2,

  // Everything else falls to DEFAULT_MINING_WEIGHT.
};

/**
 * One spelling for one mineral.
 *
 * "Low Temperature Diamonds", "lowtemperature diamonds" and "LowTemperatureDiamonds" are the same
 * rock arriving through different fields. Scoring them separately would split a miner's total in
 * ways nobody could see or explain.
 */
function normalise(material: string): string {
  return material.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * What one tonne of this mineral is worth.
 *
 * An unknown mineral scores the floor rather than nothing. Frontier adds commodities, and silently
 * dropping one would mean a miner's best night vanishing because the game shipped an update — with
 * the only symptom being a leaderboard that quietly disagrees with what people did.
 */
export function materialWeight(material: string): number {
  return MINING_WEIGHTS[normalise(material)] ?? DEFAULT_MINING_WEIGHT;
}

/**
 * Points for a refined quantity.
 *
 * `MiningRefined` fires once per whole tonne, so a fractional or negative count is a malformed
 * event or a replay — floored rather than trusted, because the alternative is letting a broken
 * client mint points.
 */
export function miningPoints(material: string, tonnes: number): number {
  if (!Number.isFinite(tonnes) || tonnes <= 0) return 0;
  return Math.floor(tonnes) * materialWeight(material);
}

/**
 * The thresholds a member has chosen.
 *
 * ★ SQUADRON OWNER, 2026-08-06: "allow the user the option to select percentages" ★
 *
 * Per material as well as a default, because 20% Painite is a good rock and 20% Bauxite is not
 * worth the limpet. One number for everything would make the alert useless in exactly the rings
 * where it matters most.
 */
export interface ProspectThresholds {
  /** Applied to any material without its own number. */
  readonly default: number;
  /** Keyed by material name in any spelling; normalised on read. */
  readonly perMaterial: Readonly<Record<string, number>>;
}

/** What somebody who has changed nothing gets. Low enough to be useful in a mixed ring. */
export const DEFAULT_PROSPECT_THRESHOLD = 15;

/**
 * Whether this rock beats the member's bar for this material.
 *
 * The decision the prospector overlay exists to render: a rock drifts past in a couple of seconds,
 * and the whole skill of laser mining is deciding inside that window whether it is worth the time.
 */
export function worthShooting(
  material: string,
  percent: number,
  thresholds: ProspectThresholds,
): boolean {
  const key = normalise(material);

  /*
   * ★ `??` ON A LOOKUP, NOT `||` — AND THE ZERO CASE IS WHY ★
   *
   * A member who sets Void Opal to 0 means "tell me about every one of them". With `||` that would
   * silently fall through to the default: the setting would look saved and do nothing, which is the
   * worst kind of bug because the member can see their own number on the screen.
   */
  const own = Object.entries(thresholds.perMaterial).find(([name]) => normalise(name) === key)?.[1];
  const bar = own ?? thresholds.default;

  return percent >= bar;
}
