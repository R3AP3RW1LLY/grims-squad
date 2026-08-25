/**
 * What a group of our own systems can supply each other.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "we need a way to allow members who have multiple systems in their colonization to create a nexus
 * that will predict trade routes, and work like the raven colonial nexus system please."
 *
 * ★ THE QUESTION THIS ANSWERS ★
 *
 * `predictMarket` already says what one planned station will buy and sell once it is built. Nobody
 * has ever asked it the group question: given four systems we are building, which of them can feed
 * which, and what will we still have to fly in from outside?
 *
 * That second half is the one worth having. A member can guess that a refinery wants ore; what they
 * cannot see without this is that nothing in the whole group produces it, so every tonne is a haul
 * from somebody else's space — forever, not just during construction.
 *
 * ★ REAL WHERE WE HAVE IT, PREDICTED ELSEWHERE, AND IT SAYS WHICH — SQUADRON OWNER, 2026-08-25 ★
 *
 * A group is routinely a mixture: one station finished and selling into the market mirror, three
 * still being hauled to. The platform holds around eighteen million real price rows, and a built
 * station's actual orders beat any model of them.
 *
 * So each system carries its own basis, and a route says whether it can be flown TONIGHT — true
 * only when both ends are standing. Presenting a predicted route identically to a real one would
 * send somebody to a station that does not exist, which is the single most expensive way this
 * feature could be wrong: a wasted trip is measured in hours.
 *
 * The predicted half is still the point for planning. It is about a future a member can change,
 * which is exactly why it is worth showing before they commit a fortnight of hauling — it just must
 * not be mistaken for the present.
 */

/**
 * How well we know what a system trades.
 *
 * ★ SQUADRON OWNER, 2026-08-25 ★
 *
 * Asked whether to use real market data or the economy model's prediction, the answer was: real
 * where we have it, predicted elsewhere, and say which is which.
 *
 * That distinction has to travel per system rather than being a caption on the panel, because a
 * group will routinely be a mixture — one station finished and selling, three still being hauled to.
 * A route drawn from `measured` can be flown tonight. One drawn from `predicted` cannot be flown at
 * all yet, and presenting them identically would send somebody to a station that does not exist.
 */
export type NexusBasis =
  /** Read from the market mirror: this station is built and these are its real orders. */
  | 'measured'
  /** The economy model's expectation for a plan nobody has finished. */
  | 'predicted'
  /** In the group, but with nothing planned and nothing built. Contributes nothing. */
  | 'unknown';

/** One system's market, however we came to know it. */
export interface NexusSystem {
  readonly systemName: string;
  /** Commodities the system SELLS, or is expected to. */
  readonly exports: readonly string[];
  /** Commodities it BUYS, or is expected to. */
  readonly imports: readonly string[];
  /**
   * Where those two lists came from.
   *
   * Optional so callers written before this existed keep working, and defaulted to `predicted`
   * because that is what the nexus originally computed — a silent upgrade to `measured` would claim
   * knowledge the caller never supplied.
   */
  readonly basis?: NexusBasis | undefined;
}

/** One system feeding another. */
export interface NexusLink {
  readonly commodity: string;
  readonly from: string;
  readonly to: string;
  /**
   * Whether this route can be flown TODAY.
   *
   * True only when both ends are `measured` — a real seller and a real buyer, both standing. Any
   * other combination is a route that exists on paper and would waste a trip, so the two are never
   * mixed in one list without saying so.
   */
  readonly flyableNow: boolean;
}

export interface NexusReport {
  /** Every supplier→buyer pair the group can satisfy internally. */
  readonly links: readonly NexusLink[];
  /**
   * Commodities somebody wants that NOBODY in the group produces.
   *
   * The most useful line here, and the one no per-system view can show: a permanent import, which
   * means a permanent haul from outside the group unless the plans change.
   */
  readonly gaps: readonly { readonly commodity: string; readonly wantedBy: readonly string[] }[];
  /**
   * Commodities produced that nobody in the group wants.
   *
   * Not a fault — it is what a system sells to the wider galaxy, and often the whole point of
   * building it. Surfaced because it is the other half of the same question, and because two
   * systems both exporting the same thing and neither buying it is worth noticing before the
   * second one is built.
   */
  readonly surplus: readonly { readonly commodity: string; readonly soldBy: readonly string[] }[];
  /**
   * Systems in the group with nothing planned and nothing built.
   *
   * Squadron owner, 2026-08-25: listed rather than skipped. A system quietly missing from its own
   * group reads as a bug -- a pattern this codebase keeps finding -- and naming it is also the nudge
   * to go and plan it. It contributes no exports or imports, so it cannot distort the gaps.
   */
  readonly unplanned: readonly string[];
  /** How many systems contributed. Zero and one are different answers and read differently. */
  readonly systems: number;
}

/** Case-insensitive, because the catalogue, the market dump and the journal disagree on case. */
const key = (s: string): string => s.trim().toLowerCase();

/**
 * Matches what the group produces against what it needs.
 *
 * ★ A SYSTEM NEVER FEEDS ITSELF ★
 *
 * A station that exports ore and another in the same system that wants it is an internal matter —
 * no route, no hauling between systems, nothing for this to say. Counting it would inflate the
 * links with pairs nobody flies, and bury the ones somebody would.
 */
export function nexusTrade(systems: readonly NexusSystem[]): NexusReport {
  const sellers = new Map<string, { label: string; from: Set<string> }>();
  const buyers = new Map<string, { label: string; to: Set<string> }>();
  /* Which systems are standing, so a route can say whether it is flyable tonight. */
  const measured = new Set<string>();
  const unplanned: string[] = [];

  for (const system of systems) {
    const basis: NexusBasis = system.basis ?? 'predicted';
    if (basis === 'measured') measured.add(system.systemName);
    if (basis === 'unknown') {
      /*
       * Kept in the group and named, contributing nothing. Its lists are ignored even if a caller
       * supplied some: `unknown` means we have no basis for them, and honouring them anyway would
       * put invented trade into the gaps.
       */
      unplanned.push(system.systemName);
      continue;
    }

    for (const commodity of system.exports) {
      const k = key(commodity);
      if (k === '') continue;
      const row = sellers.get(k) ?? { label: commodity.trim(), from: new Set<string>() };
      row.from.add(system.systemName);
      sellers.set(k, row);
    }
    for (const commodity of system.imports) {
      const k = key(commodity);
      if (k === '') continue;
      const row = buyers.get(k) ?? { label: commodity.trim(), to: new Set<string>() };
      row.to.add(system.systemName);
      buyers.set(k, row);
    }
  }

  const links: NexusLink[] = [];
  const gaps: { commodity: string; wantedBy: string[] }[] = [];

  for (const [k, buyer] of buyers) {
    const seller = sellers.get(k);

    if (seller === undefined) {
      gaps.push({ commodity: buyer.label, wantedBy: [...buyer.to].sort() });
      continue;
    }

    const pairs: NexusLink[] = [];
    for (const to of buyer.to) {
      for (const from of seller.from) {
        // See the header: a system feeding itself is not a route.
        if (from === to) continue;
        pairs.push({
          commodity: buyer.label,
          from,
          to,
          // Both ends standing, or it is a route on paper only.
          flyableNow: measured.has(from) && measured.has(to),
        });
      }
    }

    if (pairs.length === 0) {
      /*
       * Wanted and produced, but only ever by the same system. From the group's point of view that
       * is still a gap: no other system can supply it, and if that one is not finished first the
       * demand has nowhere to go.
       */
      gaps.push({ commodity: buyer.label, wantedBy: [...buyer.to].sort() });
      continue;
    }

    links.push(...pairs.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)));
  }

  const surplus: { commodity: string; soldBy: string[] }[] = [];
  for (const [k, seller] of sellers) {
    if (buyers.has(k)) continue;
    surplus.push({ commodity: seller.label, soldBy: [...seller.from].sort() });
  }

  const byCommodity = (a: { commodity: string }, b: { commodity: string }): number =>
    a.commodity.localeCompare(b.commodity);

  return {
    links: [...links].sort(
      (a, b) => a.commodity.localeCompare(b.commodity) || a.from.localeCompare(b.from),
    ),
    gaps: gaps.sort(byCommodity),
    surplus: surplus.sort(byCommodity),
    unplanned: [...unplanned].sort(),
    systems: systems.length,
  };
}

/**
 * The report in a member's words.
 *
 * ★ GAPS FIRST ★
 *
 * The same ordering every other panel on this platform uses: the thing that might change a decision
 * comes before the thing that confirms it. "Four systems feed each other" is pleasant and changes
 * nothing; "nothing you are building produces this, so it is a permanent import" is the sentence
 * somebody acts on.
 */
export function describeNexus(report: NexusReport): readonly string[] {
  if (report.systems === 0) return ['No systems in this group yet.'];
  if (report.systems === 1) {
    // Said plainly: a nexus of one has nothing to compare, and an empty table looks like a failure.
    return ['A group needs more than one system before anything can feed anything else.'];
  }

  const lines: string[] = [];

  if (report.gaps.length > 0) {
    lines.push(
      `${report.gaps.length} commodit${report.gaps.length === 1 ? 'y is' : 'ies are'} wanted that nothing in this group produces — a permanent haul from outside unless the plans change.`,
    );
  }

  if (report.links.length > 0) {
    const internal = new Set(report.links.map((l) => l.commodity)).size;
    lines.push(
      `${internal} commodit${internal === 1 ? 'y' : 'ies'} can be supplied from inside the group.`,
    );
  }

  if (report.surplus.length > 0) {
    lines.push(
      `${report.surplus.length} ${report.surplus.length === 1 ? 'is' : 'are'} produced with no buyer here — those are what the group sells outward.`,
    );
  }

  if (lines.length === 0) {
    /*
     * Two or more systems and nothing to say about any of them. Said in words, because an empty
     * panel and a panel that failed to load are the same thing on screen.
     */
    lines.push('These systems do not trade with each other, and none of them needs what the others make.');
  }

  return lines;
}
