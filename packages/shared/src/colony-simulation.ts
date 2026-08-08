/**
 * Does this plan actually work?
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "make the Colonisation system ultra feature ritch ... ensure our baseline colonization setup we
 * have now meets and exceeds the current feature and system of raven colonial! include the ability
 * to pre plan entire system colonization etc!"
 *
 * ★ THE PROBLEM THIS EXISTS TO SOLVE ★
 *
 * Colonisation is not "haul enough tonnage and a station appears". The game runs a second economy
 * on top of the hauling — CONSTRUCTION POINTS. Tier-1 builds earn tier-2 points, tier-2 builds
 * spend them and earn tier-3 points, tier-3 builds spend those. Some builds also require a
 * particular kind of site to exist in the system already.
 *
 * A squadron that plans a system without tracking this discovers the problem the expensive way: a
 * fortnight of hauling, and then a starport the game will not let anybody start. That is the single
 * costliest mistake available in this feature, and it is entirely preventable BEFORE anybody
 * undocks — which is what this module is for.
 *
 * ★ EVERY RULE HERE IS A GAME RULE, AND EVERY ONE IS CITED ★
 *
 * Frontier publishes none of it. What follows was gathered by players, and the two independent
 * sources — the community wiki and RavenColonial's model — agree on the point costs and the
 * prerequisites. Where they agree, this treats the rule as settled. Where nobody has confirmed
 * anything (the system-effect scalars), the planner labels the numbers on screen as gathered rather
 * than published, because a member deciding how to spend a fortnight deserves to know which is
 * which.
 *
 * ★ PURE, AND DELIBERATELY SO ★
 *
 * No database, no clock, no fetch. It takes a build order and the catalogue rows behind it and
 * returns what the plan does. That is what lets the website and the companion app run the IDENTICAL
 * simulation rather than two that drift — the failure the owner has objected to twice.
 */

/** The construction-point rules a build type carries. */
export interface SimBuildType {
  readonly id: string;
  readonly displayName: string;
  readonly tier: number;
  readonly buildClass: string;
  /** Points this SPENDS. Tier 0 means it costs none. */
  readonly needsTier: number;
  readonly needsPoints: number;
  /** Points this EARNS. Tier 0 means it grants none. */
  readonly givesTier: number;
  readonly givesPoints: number;
  /** A prerequisite key that must already be satisfied in the system, or null. */
  readonly requires: string | null;
  /** The prerequisite keys this build satisfies for others. */
  readonly satisfies: readonly string[];
  readonly effects: SystemEffects;
  /**
   * The economy this build votes for, or null. `none` is a real catalogue value meaning "no vote"
   * and is treated the same as null.
   */
  readonly influence?: string | null | undefined;
  /**
   * Set only on builds that FIX the system's economy. It binds only when the build opens the plan;
   * see `PlanEconomy`.
   */
  readonly fixed?: string | null | undefined;
}

/**
 * What the system ends up being, as opposed to what it ends up scoring.
 *
 * ★ THE RESULT A MEMBER ACTUALLY CARES ABOUT ★
 *
 * Effects say how good the system gets. This says what it IS — refinery, high tech, extraction —
 * and that is what decides whether the plan was worth building. It is decided by simple majority
 * of influences, except when it is not: a build carrying `fixed`, placed first, sets it outright
 * and no later vote can move it.
 */
export interface PlanEconomy {
  /** Every economy voted for, and how many builds voted for it. */
  readonly counts: Readonly<Record<string, number>>;
  /** What the system becomes. Null when nothing in the order votes. */
  readonly primary: string | null;
  /** The runner-up, which is the system's secondary economy. Null when only one economy votes. */
  readonly secondary: string | null;
  /** True when the opening build fixed the economy, making `primary` permanent. */
  readonly locked: boolean;
  /** The build id that locked it, for a message that can name the culprit. */
  readonly lockedBy: string | null;
}

/** What a finished build does to the system it is in. */
export interface SystemEffects {
  readonly population: number;
  readonly maxPopulation: number;
  readonly security: number;
  readonly technology: number;
  readonly wealth: number;
  readonly standardOfLiving: number;
  readonly development: number;
}

export const NO_EFFECTS: SystemEffects = {
  population: 0,
  maxPopulation: 0,
  security: 0,
  technology: 0,
  wealth: 0,
  standardOfLiving: 0,
  development: 0,
};

/** One planned build, in the order it would be constructed. */
export interface SimSite {
  readonly id: string;
  /** Null while somebody has placed a slot but not yet chosen what goes in it. */
  readonly buildTypeId: string | null;
}

/** What the simulation says about one step of the build order. */
export interface SimStep {
  readonly siteId: string;
  readonly buildTypeId: string | null;
  /** Points this step spends, AFTER the escalating starport surcharge. */
  readonly spend: { readonly tier: number; readonly points: number } | null;
  /** How much of the spend is surcharge rather than base cost. Zero when untaxed. */
  readonly surcharge: number;
  readonly earn: { readonly tier: number; readonly points: number } | null;
  /** Running balance AFTER this step. Negative means the plan cannot reach here. */
  readonly tier2: number;
  readonly tier3: number;
  /** The first station in the system. The game charges it nothing. */
  readonly isPrimary: boolean;
  /** Everything wrong with this step, in the order a member would fix it. */
  readonly problems: readonly SimProblem[];
}

export interface SimProblem {
  readonly kind: 'points' | 'prerequisite' | 'unchosen';
  /** A sentence written for a member, not a code. */
  readonly message: string;
}

export interface SimResult {
  readonly steps: readonly SimStep[];
  /** The balance when the whole order is done. */
  readonly tier2: number;
  readonly tier3: number;
  /** Every problem across the plan, so a summary panel does not have to walk the steps. */
  readonly problems: readonly SimProblem[];
  /** The system's totals if the whole order is built. */
  readonly effects: SystemEffects;
  /** What the system becomes: the economy the order votes for, or the one its opener fixed. */
  readonly economy: PlanEconomy;
  /** How many non-primary tier-2/3 starports carried a surcharge. */
  readonly surchargedPorts: number;
}

/**
 * The names of the prerequisites, written for a member.
 *
 * ★ A KEY IS NOT A SENTENCE ★
 *
 * The database stores `settlementMilitary`, because that is stable and joins against what other
 * builds declare they satisfy. A member reads "a military settlement". Keeping the two apart means
 * the wording can be fixed without a migration, and an unknown key still says something honest
 * rather than rendering as an internal identifier.
 */
const PREREQUISITE_NAMES: Readonly<Record<string, string>> = {
  satellite: 'a satellite installation',
  comms: 'a comms installation',
  relay: 'a relay installation',
  installationAgr: 'an agricultural installation',
  installationMil: 'a military installation',
  outpostMining: 'a mining or industrial installation',
  settlementAgr: 'an agricultural settlement',
  settlementBio: 'a high tech settlement',
  settlementTourist: 'a tourism settlement',
  settlementMilitary: 'a military settlement',
  settlementExtraction: 'an extraction settlement',
};

export const prerequisiteName = (key: string): string =>
  PREREQUISITE_NAMES[key] ?? `something the game calls ${key}`;

/**
 * The surcharge on extra starports.
 *
 * ★ THE FIRST TWO ARE FREE OF IT, THE THIRD ONWARD IS NOT ★
 *
 * The game makes each additional tier-2 or tier-3 starport in a system cost more than the last.
 * Both sources agree on the shape: a tier-3 starport costs 6 points, then 12, then 18; a tier-2
 * costs 3, then 5, then 7. Expressed as a multiplier that is +100% per step for tier 3 and +75%
 * per step for tier 2, truncated — which reproduces 3 → 5 → 7 exactly (3 + trunc(2.25) = 5,
 * 3 + trunc(4.5) = 7) where a rounded +75% would give 3 → 5 → 8.
 *
 * The truncation is not a detail. It is the difference between a plan that says you can afford the
 * third port and one that says you cannot.
 *
 * `alreadyBuilt` counts the non-primary tier-2/3 starports EARLIER in the order. The first two are
 * charged the base cost, so the surcharge only begins at the third.
 */
export function surchargedCost(tier: number, base: number, alreadyBuilt: number): number {
  const steps = alreadyBuilt - 2;
  if (steps <= 0) return base;
  return tier === 3 ? base + base * steps : base + Math.trunc(base * 0.75 * steps);
}

/** Whether a build type is one the surcharge applies to. */
const isChargeablePort = (type: SimBuildType): boolean =>
  type.buildClass === 'starport' && (type.tier === 2 || type.tier === 3);

/**
 * Runs the plan.
 *
 * ★ IN ORDER, BECAUSE THE ORDER IS THE POINT ★
 *
 * The same set of builds in a different sequence is a different plan — one that works and one that
 * stalls. So this walks the order and reports the balance at every step, rather than totalling the
 * whole thing and declaring it fine. A deficit at step four is invisible in a total that step nine
 * pays back, and step four is where somebody actually gets stuck.
 */
export function simulatePlan(
  sites: readonly SimSite[],
  catalogue: ReadonlyMap<string, SimBuildType>,
): SimResult {
  let tier2 = 0;
  let tier3 = 0;
  let portsSoFar = 0;
  let surchargedPorts = 0;

  /* What the system already satisfies, accumulated as the order proceeds. */
  const satisfied = new Set<string>();

  /*
   * The economy vote. Counted for every build in the order, including ones that turn out to be
   * unbuildable: a member fixing a broken plan needs to see what it WOULD become, not a tally that
   * empties out because step four ran short of points.
   */
  const counts = new Map<string, number>();
  let lockedTo: string | null = null;
  let lockedBy: string | null = null;

  const effects = {
    population: 0,
    maxPopulation: 0,
    security: 0,
    technology: 0,
    wealth: 0,
    standardOfLiving: 0,
    development: 0,
  };

  const steps: SimStep[] = [];
  const problems: SimProblem[] = [];

  sites.forEach((site, index) => {
    const type = site.buildTypeId === null ? undefined : catalogue.get(site.buildTypeId);

    if (type === undefined) {
      const problem: SimProblem = {
        kind: 'unchosen',
        message:
          site.buildTypeId === null
            ? 'Nothing has been chosen for this slot yet, so it costs and earns nothing.'
            : 'We do not hold this build in the catalogue, so it is left out of the sums.',
      };
      problems.push(problem);
      steps.push({
        siteId: site.id,
        buildTypeId: site.buildTypeId,
        spend: null,
        surcharge: 0,
        earn: null,
        tier2,
        tier3,
        isPrimary: index === 0,
        problems: [problem],
      });
      return;
    }

    /*
     * ★ THE PRIMARY PORT IS EXEMPT ★
     *
     * The first station in a system is what claims it, and the game charges no construction points
     * for it — there are none yet to charge. Position 0 IS the primary, which is why moving the top
     * row of the build order changes what the plan costs and why the page says so out loud.
     */
    const isPrimary = index === 0;
    const here: SimProblem[] = [];

    let spend: { tier: number; points: number } | null = null;
    let surcharge = 0;

    if (!isPrimary && type.needsPoints > 0) {
      let cost = type.needsPoints;

      if (isChargeablePort(type)) {
        const charged = surchargedCost(type.tier, cost, portsSoFar);
        surcharge = charged - cost;
        cost = charged;
        portsSoFar += 1;
        if (surcharge > 0) surchargedPorts += 1;
      }

      spend = { tier: type.needsTier, points: cost };
      if (type.needsTier === 3) tier3 -= cost;
      else tier2 -= cost;

      const balance = type.needsTier === 3 ? tier3 : tier2;
      if (balance < 0) {
        here.push({
          kind: 'points',
          message:
            `${type.displayName} costs ${cost} tier ${type.needsTier} point${cost === 1 ? '' : 's'}` +
            `${surcharge > 0 ? ` (${surcharge} of that is the surcharge on extra starports)` : ''}` +
            `, and the plan is ${Math.abs(balance)} short at this step. Build something that earns` +
            ` tier ${type.needsTier} points before it.`,
        });
      }
    } else if (isPrimary && isChargeablePort(type)) {
      // Exempt from the CHARGE, but it still counts toward what the next port is charged. Missing
      // this makes the third port look affordable when the game will treat it as the fourth.
      portsSoFar += 1;
    }

    /* Prerequisites are checked against what is EARLIER in the order, never the whole plan. */
    if (type.requires !== null && !satisfied.has(type.requires)) {
      here.push({
        kind: 'prerequisite',
        message: `${type.displayName} needs ${prerequisiteName(type.requires)} in the system first.`,
      });
    }

    let earn: { tier: number; points: number } | null = null;
    if (type.givesPoints > 0) {
      earn = { tier: type.givesTier, points: type.givesPoints };
      if (type.givesTier === 3) tier3 += type.givesPoints;
      else tier2 += type.givesPoints;
    }

    for (const key of type.satisfies) satisfied.add(key);

    /*
     * `none` is a real catalogue value, not a missing one. Counting it would invent an economy that
     * outvotes the genuine ones, which is exactly the kind of quiet wrongness this panel exists to
     * prevent.
     */
    const vote = type.influence ?? null;
    if (vote !== null && vote !== 'none') counts.set(vote, (counts.get(vote) ?? 0) + 1);

    /*
     * The lock binds ONLY on the opener, matching `checkColonyPlan` exactly. Placed later the same
     * build is an ordinary vote. The two must not disagree — they are read side by side on one page.
     */
    if (index === 0 && type.fixed != null && type.fixed !== '') {
      lockedTo = type.fixed;
      lockedBy = type.id;
    }

    effects.population += type.effects.population;
    effects.maxPopulation += type.effects.maxPopulation;
    effects.security += type.effects.security;
    effects.technology += type.effects.technology;
    effects.wealth += type.effects.wealth;
    effects.standardOfLiving += type.effects.standardOfLiving;
    effects.development += type.effects.development;

    problems.push(...here);
    steps.push({
      siteId: site.id,
      buildTypeId: site.buildTypeId,
      spend,
      surcharge,
      earn,
      tier2,
      tier3,
      isPrimary,
      problems: here,
    });
  });

  /*
   * Ranked by votes, ties broken by NAME. Without the tiebreak two economies on equal counts would
   * swap places between renders depending on Map insertion order, and a panel that reorders itself
   * on a redraw reads as a bug in the plan rather than in the sort.
   */
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const voted = ranked[0]?.[0] ?? null;

  const economy: PlanEconomy = {
    counts: Object.fromEntries(ranked),
    primary: lockedTo ?? voted,
    // A locked system has no runner-up worth naming: the votes no longer decide anything.
    secondary: lockedTo !== null ? null : (ranked[1]?.[0] ?? null),
    locked: lockedTo !== null,
    lockedBy,
  };

  return { steps, tier2, tier3, problems, effects, economy, surchargedPorts };
}
