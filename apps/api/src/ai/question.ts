/**
 * Working out what KIND of question was asked.
 *
 * ★ WHY THIS IS NOT THE MODEL'S JOB ★
 *
 * The fashionable answer is to let the model choose its own tools. That means a round trip to
 * decide, another to answer, and a decision made by the component least able to explain itself —
 * when it picks wrong the failure is silent and unreproducible.
 *
 * The four retrievals are distinguished by grammar, not by meaning. "Where can I sell Painite"
 * is a market question because of the words "sell" and a commodity; "stations near Deciat" is
 * spatial because of "near" and a system name. That is a job for rules that can be read, tested,
 * and corrected by editing one line.
 *
 * ★ AND WHEN IN DOUBT IT ASKS EVERYTHING ★
 *
 * Routing to exactly one retrieval is a bet, and losing it means answering "no idea" to a question
 * we had the facts for. Every question therefore gets a semantic search regardless; the specific
 * legs are ADDED when their signal is present. Being wrong then costs a few extra rows of context,
 * not an answer.
 */

/** What to retrieve for one question. */
export interface Plan {
  /** Always true — meaning-based search is the floor, not a branch. */
  readonly semantic: boolean;
  /** Look these up by name: ship names, module names, systems, stations. */
  readonly names: readonly string[];
  /** Set when the question is about buying or selling a named commodity. */
  readonly market: { readonly commodity: string; readonly side: 'buy' | 'sell' } | null;
  /** Set when the question is about proximity to a named system. */
  readonly near: { readonly system: string; readonly radiusLy: number } | null;
  /**
   * Set when the question is "what should I fly for X".
   *
   * ★ SQUADRON OWNER ★
   *
   * "we want this to be promptable and answered in the Ask GDSM AI" — the fitting engine, reachable
   * by asking rather than only through the Shipyard's stepper.
   *
   * ★ THE FITTER IS A RETRIEVAL LEG, NOT A TOOL THE MODEL CALLS ★
   *
   * It sits beside the market and spatial legs and obeys the same rule as the rest of this file:
   * grammar decides, not the model. What comes back is a computed build rendered as a FACT, so the
   * model's job stays what it has always been — putting sentences around figures it did not invent.
   *
   * Letting the model call a fitting tool would have put the one component that cannot explain
   * itself in charge of deciding whether to spend two hundred million credits.
   */
  readonly fit: {
    readonly role: 'mining' | 'combat' | 'explorer' | 'trader';
    readonly budget: number | null;
    readonly shipId: string | null;
  } | null;
}

/**
 * Words that mean "I want to hand cargo over" versus "I want to acquire it".
 *
 * Order matters in `sideOf`: "where do I buy X to sell at Y" contains both, and the FIRST verb is
 * the one describing what the member is about to do.
 */
const SELL_WORDS = /\b(sell|selling|sold|offload|unload|dump|deliver)\b/i;
const BUY_WORDS = /\b(buy|buying|bought|purchase|source|acquire|find|get)\b/i;

/** Phrasings that mean "near a place". */
const NEAR_PATTERN =
  /\b(?:near(?:est|by)?|close to|around|within(?:\s+(\d+)\s*ly)?|(\d+)\s*ly\s+(?:of|from))\b/i;

/**
 * A system name after a proximity word.
 *
 * Deliberately greedy about capitals and permissive about the rest: Elite system names are
 * genuinely shaped like "Col 285 Sector IR-V b2-7" and "HIP 43008", and a pattern tight enough to
 * exclude ordinary words would exclude most of the galaxy.
 */
const SYSTEM_AFTER_NEAR =
  /\b(?:near|nearest|nearby|close to|around|of|from)\s+([A-Z][\w'-]*(?:\s+[A-Z0-9][\w'-]*){0,4})/;

/** How far to look when the member says "near" but not how near. */
const DEFAULT_RADIUS_LY = 50;

/** Bounded so a typo cannot ask for the whole galaxy. */
const MAX_RADIUS_LY = 250;

export function planFor(
  question: string,
  commodities: readonly string[],
  /** Hull names to match "fit my Python" against. Empty is fine — the leg then works on role alone. */
  ships: ReadonlyArray<{ id: string; name: string }> = [],
): Plan {
  const q = question.trim();
  const market = marketIn(q, commodities);
  const near = nearIn(q);
  const fit = fitIn(q, ships);

  /*
   * ★ A TERM IS CONSUMED BY THE LEG THAT UNDERSTOOD IT ★
   *
   * "Painite" is a capitalised word, so the name extractor picks it up — and a trigram lookup for
   * it returned the stations "Paine Mine", "Pacalite" and "Pate". Three rows of noise, handed to
   * the model as facts, inside an answer about prices.
   *
   * The market leg already knows what Painite is and is fetching real prices for it. Looking the
   * same word up a second way cannot add anything the first did not have; it can only add rows
   * that merely share letters with it.
   */
  const consumed = new Set<string>();
  if (market !== null) consumed.add(market.commodity.toLowerCase());
  if (near !== null) consumed.add(near.system.toLowerCase());

  return {
    // Always. See the note above about routing being a bet.
    semantic: true,
    names: namesIn(q).filter((n) => !consumed.has(n.toLowerCase())),
    market,
    near,
    fit,
  };
}

/**
 * Words naming a job the fitter knows how to build for.
 *
 * Longest alternatives first within each group, so "exploration" is not matched as "explore" with a
 * trailing fragment left over.
 */
const ROLE_WORDS: ReadonlyArray<{
  readonly role: 'mining' | 'combat' | 'explorer' | 'trader';
  readonly pattern: RegExp;
}> = [
  { role: 'mining', pattern: /\b(mining|miner|mine|prospect(?:ing|or)?|laser\s*mining)\b/i },
  {
    role: 'combat',
    pattern:
      /\b(combat|fighting|fight|pvp|pve|bounty|bounties|assassination|warship|gunship|conflict\s*zones?|cz)\b/i,
  },
  { role: 'explorer', pattern: /\b(exploration|exploring|explorer|explore|long[\s-]?range|jump\s*range)\b/i },
  { role: 'trader', pattern: /\b(trading|trader|trade|hauling|haulier|hauler|cargo|freight)\b/i },
];

/**
 * Phrasings that mean "tell me what to fly or what to fit".
 *
 * Required alongside a role word unless a budget or a hull was named, because "where do I sell
 * mining cargo" is a MARKET question that happens to contain "mining" — and answering it with a
 * ship recommendation would be answering a question nobody asked.
 *
 * ★ "BEST MINING SHIP" NEEDED THE GAP ★
 *
 * The first version listed `best ship` literally and missed every real phrasing: people write "best
 * mining ship", "which combat hull", "what cheap trading ship". Up to two words are allowed between
 * the question word and the noun — enough for those, and short enough that "best place to sell
 * Painite from mining" still does not match.
 */
const BUILD_INTENT =
  /\b(?:build|builds|buildout|fit|fits|fitting|outfit(?:ting)?|loadout|load[\s-]?out|refit|kit\s*out|recommend|suggest|should\s+i\s+(?:buy|get|fly)|what\s+should\s+i\s+(?:buy|get|fly)|(?:what|which|best)\s+(?:\w+\s+){0,2}(?:ship|hull))\b/i;

/**
 * A spending figure, in the shapes people write it.
 *
 * `50m`, `50 million`, `1.5b`, `200,000,000`, `250 mil`. A bare small number is NOT a budget —
 * "a 4 pip build" and "Type 9" both contain digits, and reading either as credits would produce a
 * recommendation for four credits.
 */
const BUDGET_PATTERNS: readonly RegExp[] = [
  /\b(\d+(?:\.\d+)?)\s*(?:b|bn|bil|billion)\b/i,
  /\b(\d+(?:\.\d+)?)\s*(?:m|mn|mil|million)\b/i,
  /\b(\d{1,3}(?:,\d{3})+)\s*(?:cr|credits?)?\b/i,
  /\b(\d{7,})\s*(?:cr|credits?)?\b/i,
];

/** Bounded. A typo of "1000 billion" should not be treated as a real figure. */
const MAX_BUDGET = 100_000_000_000;

export function budgetIn(q: string): number | null {
  for (const [i, pattern] of BUDGET_PATTERNS.entries()) {
    const hit = pattern.exec(q);
    if (hit?.[1] === undefined) continue;

    const raw = Number(hit[1].replace(/,/g, ''));
    if (!Number.isFinite(raw) || raw <= 0) continue;

    const scaled = i === 0 ? raw * 1_000_000_000 : i === 1 ? raw * 1_000_000 : raw;
    if (scaled > MAX_BUDGET) continue;

    return Math.round(scaled);
  }

  return null;
}

function fitIn(
  q: string,
  ships: ReadonlyArray<{ id: string; name: string }>,
): Plan['fit'] {
  const role = ROLE_WORDS.find((r) => r.pattern.test(q))?.role ?? null;
  if (role === null) return null;

  const budget = budgetIn(q);

  /*
   * Longest hull name first: "Type-9 Heavy" contains "Type-9", and "Krait Mk II" contains "Krait".
   * Matching the shorter one would fit a different ship from the one that was asked about — the
   * same failure the commodity matcher avoids the same way.
   */
  const hull =
    [...ships]
      .sort((a, b) => b.name.length - a.name.length)
      .find((s) => q.toLowerCase().includes(s.name.toLowerCase())) ?? null;

  /*
   * A role word ALONE is not enough. "Where do I sell mining cargo" is a market question that
   * happens to say "mining", and fitting a ship for it would answer something nobody asked. A
   * budget or a named hull is its own evidence of intent, so either stands in for the phrasing.
   */
  if (!BUILD_INTENT.test(q) && budget === null && hull === null) return null;

  return { role, budget, shipId: hull?.id ?? null };
}

/**
 * Which side of the trade the member is on.
 *
 * ★ THE FIRST VERB WINS, AND THAT IS NOT ARBITRARY ★
 *
 * "Where can I buy Platinum to sell in Sol" contains both words. The member is asking where to BUY
 * — the selling is context. Taking the last match, or preferring one word over the other, answers
 * the wrong half of the sentence and sends them to the wrong station.
 */
export function sideOf(question: string): 'buy' | 'sell' {
  const sell = question.search(SELL_WORDS);
  const buy = question.search(BUY_WORDS);
  if (sell === -1) return 'buy';
  if (buy === -1) return 'sell';
  return buy < sell ? 'buy' : 'sell';
}

function marketIn(
  q: string,
  commodities: readonly string[],
): { commodity: string; side: 'buy' | 'sell' } | null {
  if (!SELL_WORDS.test(q) && !BUY_WORDS.test(q)) return null;

  /*
   * Matched against the commodities we actually hold, longest first.
   *
   * Longest-first matters: "Low Temperature Diamonds" contains "Diamonds", and matching the short
   * one would answer a question about a 200,000cr commodity with prices for a different one.
   */
  const lower = q.toLowerCase();
  const hit = [...commodities]
    .sort((a, b) => b.length - a.length)
    .find((c) => lower.includes(c.toLowerCase()));

  if (hit === undefined) return null;
  return { commodity: hit, side: sideOf(q) };
}

function nearIn(q: string): { system: string; radiusLy: number } | null {
  const proximity = NEAR_PATTERN.exec(q);
  if (proximity === null) return null;

  const system = SYSTEM_AFTER_NEAR.exec(q);
  if (system === null || system[1] === undefined) return null;

  const stated = Number(proximity[1] ?? proximity[2] ?? 0);
  const radiusLy = stated > 0 ? Math.min(stated, MAX_RADIUS_LY) : DEFAULT_RADIUS_LY;

  return { system: system[1].trim(), radiusLy };
}

/**
 * Proper nouns worth looking up by name.
 *
 * ★ CAPITALS, WITH THE SENTENCE OPENER DROPPED ★
 *
 * Ship and module names are capitalised in every source we hold, so capitals are the cheapest
 * available signal. The first word of a sentence is capitalised because it is first, which would
 * make "What does a Krait hold" look up "What" — so it is skipped unless it repeats later in the
 * question, where the capital means something.
 */
function namesIn(q: string): string[] {
  const words = q.split(/\s+/);
  const found: string[] = [];

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]?.replace(/[^\w'-]/g, '') ?? '';
    if (word.length < 3 || !/^[A-Z]/.test(word)) continue;
    if (i === 0 && !q.slice(1).includes(word)) continue;

    /*
     * Runs of capitalised words are joined: "Krait Mk II" and "Fleet Carrier" are single things,
     * and looking up "Krait" and "Mk" separately returns the ship and then noise.
     */
    const run = [word];
    while (i + 1 < words.length) {
      const next = words[i + 1]?.replace(/[^\w'-]/g, '') ?? '';
      if (next.length < 2 || !/^[A-Z0-9]/.test(next)) break;
      run.push(next);
      i += 1;
    }
    found.push(run.join(' '));
  }

  // Bounded: a question shouting in capitals should not turn into twenty lookups.
  return found.slice(0, 3);
}
