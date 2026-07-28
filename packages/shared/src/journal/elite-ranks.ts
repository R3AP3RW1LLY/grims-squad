/**
 * Elite Dangerous rank names.
 *
 * ★ WHY THIS IS A TABLE AND NOT A FORMULA ★
 *
 * The journal reports ranks as small integers — `{"Combat":0,"Trade":8}` — and
 * they are ordinal positions in named ladders that share no pattern. Combat runs
 * Harmless to Elite in nine steps; Trade runs Penniless to Elite in the same
 * nine but with completely different words; the naval ranks have fourteen each
 * and are specific to their superpower.
 *
 * Showing the integers would be honest and useless: nobody in the game thinks of
 * themselves as "Trade 8", they think "Tycoon".
 *
 * ★ ELITE V AND BEYOND ★
 *
 * Frontier added Elite I through V above Elite for the four pilot ranks, so the
 * ladder now runs past index 8. Anything above the table falls back to the last
 * named entry with the surplus shown, rather than rendering `undefined` — a
 * commander who has ground past Elite should not be told their rank is missing.
 */

const COMBAT = [
  'Harmless',
  'Mostly Harmless',
  'Novice',
  'Competent',
  'Expert',
  'Master',
  'Dangerous',
  'Deadly',
  'Elite',
] as const;

const TRADE = [
  'Penniless',
  'Mostly Penniless',
  'Peddler',
  'Dealer',
  'Merchant',
  'Broker',
  'Entrepreneur',
  'Tycoon',
  'Elite',
] as const;

const EXPLORE = [
  'Aimless',
  'Mostly Aimless',
  'Scout',
  'Surveyor',
  'Trailblazer',
  'Pathfinder',
  'Ranger',
  'Pioneer',
  'Elite',
] as const;

const SOLDIER = [
  'Defenceless',
  'Mostly Defenceless',
  'Rookie',
  'Soldier',
  'Gunslinger',
  'Warrior',
  'Gladiator',
  'Deadeye',
  'Elite',
] as const;

const EXOBIOLOGIST = [
  'Directionless',
  'Mostly Directionless',
  'Compiler',
  'Collector',
  'Cataloguer',
  'Taxonomist',
  'Ecologist',
  'Geneticist',
  'Elite',
] as const;

const CQC = [
  'Helpless',
  'Mostly Helpless',
  'Amateur',
  'Semi Professional',
  'Professional',
  'Champion',
  'Hero',
  'Legend',
  'Elite',
] as const;

/** The ladders a roster card shows. Naval ranks are deliberately not among them — see below. */
export const ELITE_RANK_LADDERS = {
  Combat: COMBAT,
  Trade: TRADE,
  Explore: EXPLORE,
  Soldier: SOLDIER,
  Exobiologist: EXOBIOLOGIST,
  CQC: CQC,
} as const;

export type EliteRankKey = keyof typeof ELITE_RANK_LADDERS;

/** Human labels, because `Explore` and `Exobiologist` read oddly as headings. */
export const ELITE_RANK_LABELS: Record<EliteRankKey, string> = {
  Combat: 'Combat',
  Trade: 'Trade',
  Explore: 'Exploration',
  Soldier: 'Mercenary',
  Exobiologist: 'Exobiology',
  CQC: 'CQC',
};

/** One ladder's standing. `name` is null when nothing has been reported for it. */
export interface EliteRankStanding {
  readonly key: EliteRankKey;
  readonly label: string;
  readonly name: string | null;
  readonly index: number | null;
}

/**
 * Every ladder, in a fixed order, whether or not there is a rank for it.
 *
 * ★ WHY ABSENT LADDERS ARE LISTED RATHER THAN DROPPED ★
 *
 * Showing only the ladders somebody has a rank in makes two very different
 * commanders look identical: one who has never flown a combat ship, and one
 * whose data we simply do not have. Both render as silence.
 *
 * It also makes cards incomparable — a member with three ladders and a member
 * with six produce lists of different lengths in different orders, and the eye
 * cannot scan down a column of them to see who is the better trader.
 *
 * So all six always appear. A ladder with nothing behind it says so, and
 * "Harmless" — a real rank that a rank-0 commander genuinely holds — stays
 * clearly distinct from having no reading at all.
 *
 * The ORDER is the declaration order of the ladders, not the commander's
 * achievement. Fixed position is what lets one card be read against another.
 */
export function allEliteRanks(
  held: ReadonlyArray<{ key: EliteRankKey; name: string; index: number }>,
): EliteRankStanding[] {
  const byKey = new Map(held.map((r) => [r.key, r]));

  return (Object.keys(ELITE_RANK_LADDERS) as EliteRankKey[]).map((key) => {
    const hit = byKey.get(key);
    return {
      key,
      label: ELITE_RANK_LABELS[key],
      name: hit?.name ?? null,
      // Explicitly null, not 0. Index 0 is Harmless, which is a rank somebody
      // holds — conflating it with "unknown" would misreport every new pilot.
      index: hit?.index ?? null,
    };
  });
}

/**
 * Inara's names for the same ladders.
 *
 * ★ THEY DO NOT MATCH THE JOURNAL'S, AND THE MISMATCH IS SILENT ★
 *
 * The game's journal says `Explore`; Inara says `exploration`. A lookup written
 * against one set returns undefined for the other and simply drops the rank —
 * no error, no log, just a commander whose exploration rank stops appearing.
 *
 * Both spellings are accepted for every ladder, so this keeps working whichever
 * side changes its wording. Naval ranks (`empire`, `federation`) arrive from
 * Inara and are deliberately unmapped: they are not among the ladders a roster
 * card shows, and adding them here is the only change needed if that alters.
 */
const INARA_RANK_KEYS: Record<string, EliteRankKey> = {
  combat: 'Combat',
  trade: 'Trade',
  explore: 'Explore',
  exploration: 'Explore',
  soldier: 'Soldier',
  mercenary: 'Soldier',
  exobiologist: 'Exobiologist',
  exobiology: 'Exobiologist',
  cqc: 'CQC',
};

/** One rank as Inara reports it. `rankValue` is the same ordinal the journal uses. */
export interface InaraPilotRank {
  readonly rankName?: unknown;
  readonly rankValue?: unknown;
}

/**
 * Maps Inara's rank array onto our ladders.
 *
 * Returns the SAME shape as {@link describeEliteRanks} so the two sources are
 * interchangeable at the point of display — that is what lets the roster fall
 * back from one to the other without the card knowing which it got.
 *
 * Unknown ladder names are skipped rather than guessed. Inara sends naval ranks
 * we do not show, and inventing a ladder for them would put "Empire: Elite" on
 * a card, which is not a rank that exists.
 */
export function describeInaraRanks(
  raw: unknown,
): Array<{ key: EliteRankKey; label: string; name: string; index: number }> {
  if (!Array.isArray(raw)) return [];

  const out: Array<{ key: EliteRankKey; label: string; name: string; index: number }> = [];
  const seen = new Set<EliteRankKey>();

  for (const entry of raw as InaraPilotRank[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (typeof entry.rankName !== 'string') continue;

    const key = INARA_RANK_KEYS[entry.rankName.toLowerCase().trim()];
    // Skipped, not defaulted. A ladder we do not recognise is one we cannot name.
    if (key === undefined || seen.has(key)) continue;

    const name = eliteRankName(key, entry.rankValue);
    if (name === null) continue;

    seen.add(key);
    out.push({ key, label: ELITE_RANK_LABELS[key], name, index: entry.rankValue as number });
  }

  return out;
}

/**
 * Turns a rank index into its name.
 *
 * Returns null for anything unusable rather than guessing — a missing rank and
 * a rank of Harmless are different statements, and index 0 is a real rank.
 */
export function eliteRankName(key: EliteRankKey, index: unknown): string | null {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null;

  const ladder = ELITE_RANK_LADDERS[key];
  const top = ladder.length - 1;

  // Past the named ladder: Elite I..V and whatever Frontier adds next. Shown as
  // "Elite +2" rather than dropped, because grinding past Elite is an
  // achievement and reporting nothing would read as a bug.
  if (index > top) return `${ladder[top]} +${index - top}`;

  return ladder[index] ?? null;
}

/** Every named rank a commander holds, skipping the ones we cannot read. */
export function describeEliteRanks(
  payload: Record<string, unknown>,
): Array<{ key: EliteRankKey; label: string; name: string; index: number }> {
  const out: Array<{ key: EliteRankKey; label: string; name: string; index: number }> = [];

  for (const key of Object.keys(ELITE_RANK_LADDERS) as EliteRankKey[]) {
    const raw = payload[key];
    const name = eliteRankName(key, raw);
    if (name === null) continue;
    out.push({ key, label: ELITE_RANK_LABELS[key], name, index: raw as number });
  }

  return out;
}
