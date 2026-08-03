/**
 * What economy a planned station would end up with.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make the Colonisation system ultra feature ritch ... ensure our baseline colonization setup we
 * have now meets and exceeds the current feature and system of raven colonial."
 *
 * ★ WHY THIS IS THE QUESTION WORTH ANSWERING ★
 *
 * A station's economy decides what its market carries. Put the same Coriolis around a gas giant and
 * around an earth-like world and you get two different shops — one selling industrial goods, one
 * selling food and tech. A squadron choosing where to drop a port is really choosing what their
 * system will sell for the rest of its existence, and until now nothing here could tell them.
 *
 * ★ WHERE THESE RULES COME FROM, AND WHAT IS MISSING ★
 *
 * Frontier publishes none of it. The rules below were derived by players comparing systems before
 * and after builds, and they are less settled than the construction-point costs — which is why the
 * result carries an AUDIT: every adjustment records what changed it and by how much, so a member
 * can see the reasoning rather than being handed a verdict.
 *
 * Three inputs the game uses are NOT available to us, and the result says so rather than pretending:
 *
 *   - RING RESERVE LEVEL (pristine/major boosts extraction and refinery; depleted hurts them). EDSM
 *     does not report it per body.
 *   - BIOLOGICAL AND GEOLOGICAL SIGNAL COUNTS. Not in the body payload we fetch.
 *   - TIDAL LOCKING to the parent star, which suppresses agriculture.
 *
 * A prediction that quietly omitted them would be wrong in a way nobody could see. Naming them is
 * the difference between a model and a guess dressed up as one.
 *
 * ★ PURE ★
 *
 * No database, no clock, no fetch. Same reason as the construction-point simulation: the website
 * and the companion run the identical code rather than two that drift.
 */

/** The economies the game tracks. `colony` and `none` are inputs only — never an outcome. */
export type Economy =
  | 'agriculture'
  | 'extraction'
  | 'hightech'
  | 'industrial'
  | 'military'
  | 'refinery'
  | 'service'
  | 'terraforming'
  | 'tourism';

export const ECONOMIES: readonly Economy[] = [
  'agriculture',
  'extraction',
  'hightech',
  'industrial',
  'military',
  'refinery',
  'service',
  'terraforming',
  'tourism',
];

export type EconomyScores = Readonly<Record<Economy, number>>;

const zero = (): Record<Economy, number> => ({
  agriculture: 0,
  extraction: 0,
  hightech: 0,
  industrial: 0,
  military: 0,
  refinery: 0,
  service: 0,
  terraforming: 0,
  tourism: 0,
});

/** What the model knows about a body a site could stand on. */
export interface EconBody {
  readonly bodyId: number;
  readonly kind: string;
  readonly subType: string | null;
  readonly hasRings: boolean;
  readonly terraformable: boolean;
  readonly hasVolcanism: boolean;
  readonly isLandable: boolean;
}

/** What the model knows about a build type. */
export interface EconBuildType {
  readonly id: string;
  readonly displayName: string;
  readonly tier: number;
  readonly buildClass: string;
  /** What this contributes to whatever it links to. `none` for the many that contribute nothing. */
  readonly economyInfluence: string;
  /** Set only when the build's OWN economy is locked regardless of surroundings. */
  readonly economyFixed: string | null;
}

/** One planned site, placed. */
export interface EconSite {
  readonly id: string;
  readonly bodyId: number | null;
  readonly location: 'orbital' | 'surface';
  readonly buildTypeId: string | null;
}

/** One thing that moved a number, and by how much. */
export interface EconAudit {
  readonly economy: Economy;
  readonly delta: number;
  readonly reason: string;
}

export interface SiteEconomy {
  readonly siteId: string;
  readonly buildTypeId: string | null;
  /**
   * Whether this site is a place with a market, or something that feeds one.
   *
   * ★ AN INSTALLATION DOES NOT HAVE AN ECONOMY ★
   *
   * Only starports and outposts trade. A satellite standing on a gas giant still picks up the
   * body's contribution in the arithmetic — that is how the model works — but printing "industrial"
   * next to it would claim it has a market to be industrial ABOUT. It does not; it makes the port
   * on its body more industrial. The page uses this to say which of the two it is looking at.
   */
  readonly receivesLinks: boolean;
  /** True when this is the port on its body that everything else feeds into. */
  readonly isReceiver: boolean;
  /** The resolved scores, floored. Empty when the site has no build chosen. */
  readonly scores: EconomyScores;
  /** Whichever economy came out highest, or null when nothing did. */
  readonly leading: Economy | null;
  /** Every adjustment, in the order it was applied. */
  readonly audit: readonly EconAudit[];
  /** Sites that feed this one strongly, by id. */
  readonly strongLinks: readonly string[];
  /** Sites that feed it weakly. */
  readonly weakLinks: readonly string[];
}

export interface EconomyResult {
  readonly sites: readonly SiteEconomy[];
  /** What the model could not take into account, said plainly for the page to print. */
  readonly blindSpots: readonly string[];
}

/**
 * What a body contributes on its own, before anything is built on it.
 *
 * ★ MATCHED ON EDSM'S PROSE, NOT ON A CODE ★
 *
 * EDSM's `subType` is a sentence — "High metal content world", "Class III gas giant". There is no
 * enumeration to switch on, so this matches the words. Ordered most specific first: "Earth-like
 * world" must be tested before the generic checks, and "Rocky Ice world" before "Rocky body".
 */
export function bodyEconomies(body: EconBody): EconAudit[] {
  const out: EconAudit[] = [];
  const sub = (body.subType ?? '').toLowerCase();
  const kind = body.kind.toLowerCase();
  const add = (economy: Economy, reason: string): void => {
    out.push({ economy, delta: 1, reason });
  };

  if (kind === 'star') {
    /*
     * The exotic remnants are worth tech and tourism — people travel to look at them. Everything
     * else a star offers is military. Both are the body's contribution, not the station's.
     */
    if (/black hole|neutron|white dwarf/.test(sub)) {
      add('hightech', 'orbiting an exotic remnant');
      add('tourism', 'people travel to see an exotic remnant');
    } else {
      add('military', 'orbiting a star');
    }
  } else if (/earth-?like/.test(sub)) {
    add('agriculture', 'an earth-like world');
    add('hightech', 'an earth-like world');
    add('military', 'an earth-like world');
    add('tourism', 'an earth-like world');
  } else if (/water world/.test(sub)) {
    add('agriculture', 'a water world');
    add('tourism', 'a water world');
  } else if (/ammonia/.test(sub)) {
    add('hightech', 'an ammonia world');
    add('tourism', 'an ammonia world');
  } else if (/gas giant|water giant|helium/.test(sub)) {
    add('hightech', 'a gas giant');
    add('industrial', 'a gas giant');
  } else if (/high metal content|metal-?rich/.test(sub)) {
    add('extraction', 'a metal-bearing world');
  } else if (/rocky ice/.test(sub)) {
    add('industrial', 'a rocky ice body');
    add('refinery', 'a rocky ice body');
  } else if (/rocky/.test(sub)) {
    add('refinery', 'a rocky body');
  } else if (/icy/.test(sub)) {
    add('industrial', 'an icy body');
  } else if (/asteroid|belt|cluster/.test(sub) || kind === 'belt') {
    add('extraction', 'an asteroid cluster');
  }

  if (body.hasRings) add('extraction', 'the body has rings');

  return out;
}

/** The buffs and nerfs the body applies on top of what it contributes. */
export function bodyBuffs(body: EconBody): EconAudit[] {
  const out: EconAudit[] = [];
  const sub = (body.subType ?? '').toLowerCase();

  if (body.terraformable) {
    out.push({ economy: 'agriculture', delta: 0.4, reason: 'terraformable' });
    out.push({ economy: 'terraforming', delta: 0.4, reason: 'terraformable' });
  }
  if (/earth-?like|water world/.test(sub)) {
    out.push({ economy: 'agriculture', delta: 0.4, reason: 'a world that can already grow things' });
  }
  if (/icy/.test(sub)) {
    // Not a rounding of the base score — a real penalty. Nothing grows on an ice ball.
    out.push({ economy: 'agriculture', delta: -0.4, reason: 'an icy body grows nothing' });
  }
  if (/earth-?like|ammonia/.test(sub)) {
    out.push({ economy: 'hightech', delta: 0.4, reason: 'a world worth studying' });
  }
  if (body.hasVolcanism) {
    out.push({ economy: 'extraction', delta: 0.4, reason: 'volcanism' });
  }
  if (/black hole|neutron|white dwarf/.test(sub)) {
    out.push({ economy: 'tourism', delta: 0.4, reason: 'an exotic remnant draws visitors' });
  }

  return out;
}

/** Only starports and outposts can be the thing others on a body feed into. */
const canReceiveLinks = (type: EconBuildType): boolean =>
  type.buildClass === 'starport' || type.buildClass === 'outpost';

/** What one link is worth, by the tier of the site doing the feeding. */
export function strongLinkStrength(tier: number): number {
  if (tier >= 3) return 1.2;
  if (tier === 2) return 0.8;
  return 0.4;
}

/** Every link is the same tiny nudge when it comes from another body. */
export const WEAK_LINK_STRENGTH = 0.05;

/** The floor. A score never reaches zero — an economy is present or it is not there at all. */
const FLOOR = 0.1;

const asEconomy = (raw: string | null): Economy | null =>
  raw !== null && (ECONOMIES as readonly string[]).includes(raw) ? (raw as Economy) : null;

/**
 * Works out what each planned station's economy would resolve to.
 *
 * ★ THE LINK TOPOLOGY IS THE PART THAT SURPRISES PEOPLE ★
 *
 * Sites do not stand alone. On each body the game elects a receiving port — the highest-tier
 * starport or outpost there — and everything else on that body feeds INTO it strongly. Sites on
 * OTHER bodies feed it weakly, at a twentieth of the strength. So six settlements scattered across
 * a system barely move a port's economy, and the same six on its own body transform it.
 *
 * That is why a planner is worth having: the answer depends on an arrangement, not on a list.
 */
export function resolveEconomies(
  sites: readonly EconSite[],
  bodies: readonly EconBody[],
  catalogue: ReadonlyMap<string, EconBuildType>,
): EconomyResult {
  const bodyOf = new Map(bodies.map((b) => [b.bodyId, b]));
  const typeOf = (s: EconSite): EconBuildType | undefined =>
    s.buildTypeId === null ? undefined : catalogue.get(s.buildTypeId);

  /*
   * Elect the receiving port on each body, per location. A surface settlement cannot feed an
   * orbital station and vice versa — they are separate economies sharing a rock.
   */
  const receiver = new Map<string, EconSite>();
  for (const site of sites) {
    const type = typeOf(site);
    if (type === undefined || site.bodyId === null || !canReceiveLinks(type)) continue;

    const key = `${site.bodyId}:${site.location}`;
    const held = receiver.get(key);
    const heldTier = held === undefined ? -1 : (typeOf(held)?.tier ?? -1);
    if (type.tier > heldTier) receiver.set(key, site);
  }

  const out: SiteEconomy[] = [];

  for (const site of sites) {
    const type = typeOf(site);
    if (type === undefined) {
      out.push({
        siteId: site.id,
        buildTypeId: site.buildTypeId,
        receivesLinks: false,
        isReceiver: false,
        scores: zero(),
        leading: null,
        audit: [],
        strongLinks: [],
        weakLinks: [],
      });
      continue;
    }

    const audit: EconAudit[] = [];
    const scores = zero();
    const apply = (entry: EconAudit): void => {
      audit.push(entry);
      scores[entry.economy] += entry.delta;
    };

    const body = site.bodyId === null ? undefined : bodyOf.get(site.bodyId);

    /*
     * A FIXED economy overrides the body entirely. A Pirate Outpost is a service economy in orbit
     * of a black hole exactly as it is around a rock — that is what "fixed" means, and inheriting
     * the body's contribution on top would make it something the game never produces.
     */
    const fixed = asEconomy(type.economyFixed);
    if (fixed !== null) {
      apply({
        economy: fixed,
        delta: site.location === 'orbital' ? 1 : 0.5,
        reason: `${type.displayName} is always a ${fixed} economy`,
      });
    } else if (body !== undefined) {
      for (const entry of bodyEconomies(body)) apply(entry);
      for (const entry of bodyBuffs(body)) apply(entry);
    }

    /* What feeds this site. Only a receiving port receives anything. */
    const strongLinks: string[] = [];
    const weakLinks: string[] = [];
    const trades = canReceiveLinks(type);
    let isReceiver = false;

    if (trades && site.bodyId !== null) {
      isReceiver = receiver.get(`${site.bodyId}:${site.location}`)?.id === site.id;

      if (isReceiver) {
        for (const other of sites) {
          if (other.id === site.id) continue;
          const otherType = typeOf(other);
          if (otherType === undefined) continue;

          const influence = asEconomy(otherType.economyInfluence);
          const sameBody = other.bodyId !== null && other.bodyId === site.bodyId;
          const strong = sameBody && other.location === site.location;

          if (strong) strongLinks.push(other.id);
          else weakLinks.push(other.id);

          // Nothing to contribute is still a link — it just moves no number. Recording the link
          // and skipping the score keeps the diagram honest about what is connected.
          if (influence === null) continue;

          apply({
            economy: influence,
            delta: strong ? strongLinkStrength(otherType.tier) : WEAK_LINK_STRENGTH,
            reason: strong
              ? `${otherType.displayName} on the same body`
              : `${otherType.displayName} elsewhere in the system`,
          });
        }
      }
    }

    /* Floor, then find the leader. */
    let leading: Economy | null = null;
    for (const economy of ECONOMIES) {
      if (scores[economy] > 0 && scores[economy] < FLOOR) scores[economy] = FLOOR;
      if (scores[economy] > 0 && (leading === null || scores[economy] > scores[leading])) {
        leading = economy;
      }
    }

    out.push({
      siteId: site.id,
      buildTypeId: site.buildTypeId,
      receivesLinks: trades,
      isReceiver,
      scores,
      leading,
      audit,
      strongLinks,
      weakLinks,
    });
  }

  return {
    sites: out,
    blindSpots: [
      'ring reserve level, which the game uses to boost or suppress extraction and refinery',
      'biological and geological signals, which raise agriculture and extraction',
      'whether a body is tidally locked to its star, which suppresses agriculture',
    ],
  };
}
