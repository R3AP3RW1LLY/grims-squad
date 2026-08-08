/**
 * Choosing a system without typing it again.
 *
 * ★ SQUADRON OWNER, 2026-08-08 ★
 *
 * "when someone is in the freight office or in the where to buy screen in the colonization module,
 * or any where that asks to enter a system, that it saves entries and keeps them in a dropdown or a
 * 'book mark' system so that they can just find stuff they have entered quick instead of constantly
 * having to type this information in"
 *
 * Fourteen fields ask for a system across the two surfaces — seven on the website (freight office,
 * commodities index, commodity detail, shopping list, build types, scout, post project) and seven
 * in the app (trade, commodities, commodity detail, build types, scout, colonisation, planning).
 * Every one is a bare text box today. The platform already ships a `CopySystem` button whose only
 * purpose is to spare people retyping these, which is the clearest possible statement of the
 * problem.
 *
 * ★ IT IS NOT ONLY A CONVENIENCE ★
 *
 * On 2026-08-07 the owner typed his own system into the scout and was told:
 *
 *   "We hold no coordinates for COL 285 SECTOR GL-W C2-12. Check the spelling — it has to match
 *    the game."
 *
 * The spelling was perfect. We simply did not hold the system, and the error blamed the member. A
 * box that offers what we actually have cannot produce that sentence, and when a system genuinely
 * is missing it can say so honestly instead of accusing somebody of a typo.
 *
 * ★ PURE, AND SHARED, FOR THE USUAL REASON ★
 *
 * The order of the dropdown is a rule, not a rendering choice. A member who pins a system on the
 * website and opens the app must see the same list in the same order, so the ranking lives here
 * beside the construction-point arithmetic rather than being written once per surface.
 */

/** How many recently-used systems are worth keeping before the list stops being a shortcut. */
export const RECENT_KEEP = 20;

/**
 * Where a suggestion came from. The order of this list IS the priority order.
 *
 * `here` outranks `pinned` deliberately: the likeliest answer to "which system" is the one the
 * commander is standing in, and the app knows it. Making that the second click to save a pin its
 * top spot would be optimising for the rarer case.
 */
export const SYSTEM_SOURCES = ['here', 'pinned', 'project', 'carrier', 'recent', 'galaxy'] as const;

export type SystemSource = (typeof SYSTEM_SOURCES)[number];

export interface SystemChoice {
  /** The canonical system name, spelled as the galaxy holds it. */
  readonly name: string;
  readonly systemId64?: string | null | undefined;
  readonly source: SystemSource;
  /** A member's own name for a pin — "Home", "The dodec". Matched on as well as the real name. */
  readonly label?: string | null | undefined;
  /** Epoch millis. Ties are broken by this before use count. */
  readonly lastUsedAt: number;
  readonly useCount: number;
}

const RANK: Readonly<Record<SystemSource, number>> = {
  here: 0,
  pinned: 1,
  project: 2,
  carrier: 3,
  recent: 4,
  galaxy: 5,
};

/**
 * Members paste from the game, from Discord, and from this site's own copy button. Casing and
 * doubled spaces are noise in all three, so they are removed before anything is compared.
 */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * How well a candidate answers what was typed. Lower is better; null means it does not answer at
 * all and must not be offered.
 *
 * A prefix match beats a match buried mid-string, because somebody typing "col" wants the Col 285
 * sectors, not every system with "col" somewhere inside it.
 */
function matchScore(query: string, choice: SystemChoice): number | null {
  if (query === '') return 0;

  const candidates = [norm(choice.name), choice.label == null ? null : norm(choice.label)].filter(
    (v): v is string => v !== null,
  );

  let best: number | null = null;
  for (const c of candidates) {
    const at = c.indexOf(query);
    if (at < 0) continue;
    const score = at === 0 ? 0 : 1;
    if (best === null || score < best) best = score;
  }
  return best;
}

/**
 * The dropdown, in the order it should appear.
 *
 * Deduplicated by name, keeping the STRONGEST source: the same system routinely arrives pinned,
 * recently used and present in the galaxy table all at once, and offering Sol three times reads as
 * a broken page rather than a thorough one.
 */
export function rankSystemChoices(
  query: string,
  choices: readonly SystemChoice[],
): readonly SystemChoice[] {
  const q = norm(query);

  const best = new Map<string, { choice: SystemChoice; match: number }>();
  for (const choice of choices) {
    const match = matchScore(q, choice);
    if (match === null) continue;

    const key = norm(choice.name);
    const held = best.get(key);
    if (held === undefined) {
      best.set(key, { choice, match });
      continue;
    }

    /*
     * Keep the better source, and carry the better match and the busier counters across — a galaxy
     * row holds the canonical spelling while the recent row holds the usage, and the member wants
     * both.
     */
    const winner = RANK[choice.source] < RANK[held.choice.source] ? choice : held.choice;
    best.set(key, {
      choice: {
        ...winner,
        lastUsedAt: Math.max(choice.lastUsedAt, held.choice.lastUsedAt),
        useCount: Math.max(choice.useCount, held.choice.useCount),
        label: winner.label ?? choice.label ?? held.choice.label ?? null,
      },
      match: Math.min(match, held.match),
    });
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        a.match - b.match ||
        RANK[a.choice.source] - RANK[b.choice.source] ||
        b.choice.lastUsedAt - a.choice.lastUsedAt ||
        b.choice.useCount - a.choice.useCount ||
        a.choice.name.localeCompare(b.choice.name),
    )
    .map((v) => v.choice);
}

/**
 * Fold a system the member just used back into their list.
 *
 * ★ PINS ARE NEVER TRIMMED ★
 *
 * A pin is something a member asked for; a recent is a side effect of them working. Trimming by age
 * alone would quietly delete the first to make room for the second, which is the one behaviour that
 * would make the feature untrustworthy.
 */
export function recordSystemUse(
  existing: readonly SystemChoice[],
  name: string,
  atMs: number,
): readonly SystemChoice[] {
  const key = norm(name);
  const seen = existing.find((c) => norm(c.name) === key);

  const updated: SystemChoice = {
    // The stored spelling wins over what was typed: it came from the galaxy and is the right one.
    name: seen?.name ?? name.trim(),
    systemId64: seen?.systemId64 ?? null,
    source: seen?.source === 'pinned' ? 'pinned' : 'recent',
    label: seen?.label ?? null,
    lastUsedAt: atMs,
    useCount: (seen?.useCount ?? 0) + 1,
  };

  const rest = existing.filter((c) => norm(c.name) !== key);
  const pins = rest.filter((c) => c.source === 'pinned');
  const recents = rest.filter((c) => c.source !== 'pinned');

  const keptRecents =
    updated.source === 'pinned' ? recents : [updated, ...recents].slice(0, RECENT_KEEP);

  const merged = updated.source === 'pinned' ? [updated, ...pins] : [...pins];

  return [...merged, ...keptRecents].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}
