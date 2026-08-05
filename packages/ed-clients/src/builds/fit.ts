import type { FittedModule, ShipBuild } from '@grims/shared/ship-build';
import { categoryOf, type BuildCatalogue, type CatalogueModule, type CatalogueShip, type CatalogueSlot } from './catalogue.js';
import { computeStats, type BuildStats } from './stats.js';

/**
 * Fitting a ship for a job, within a budget.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "can we reliably train the AI to generate ship builds that can specialize in high efficency
 * mining, combat (dps heavy) or have a player give you a budget and have the AI tell them what ship
 * to buy and how to outfit it? this is the goal!"
 *
 * ★ THE MODEL MUST NOT BE THE ONE CHOOSING MODULES ★
 *
 * This is a deterministic search over real hulls and real modules, and it is the whole reason the
 * answer can be trusted. A language model asked to produce a loadout will produce module names that
 * do not exist, classes that do not fit, and a jump range it made up — confidently, and in the same
 * prose as a correct answer.
 *
 * So the assistant calls this, reads the result, and writes sentences about it. Every number in an
 * answer comes from Frontier's own data by way of `computeStats`. The model picks phrasing; it never
 * picks facts.
 *
 * ★ WHAT "BEST" MEANS IS A PROFILE, NOT AN OPINION ★
 *
 * Each role names the module groups it wants and how to rank candidates — an explorer rates a
 * module by lightness, a combat fit by capability. Written down per role rather than buried in one
 * scoring function, because "why did it pick that" has to be answerable, and it is answerable by
 * reading the profile.
 */

export type FitRole = 'mining' | 'combat' | 'explorer' | 'trader';

export interface FitRequest {
  readonly role: FitRole;
  /** Total credits, hull included. Undefined means no limit. */
  readonly budget?: number | undefined;
  /** Force a hull. Undefined lets the fitter choose. */
  readonly shipId?: string | undefined;
}

export interface FitResult {
  readonly build: ShipBuild;
  readonly stats: BuildStats | null;
  /** Hull plus every fitted module. */
  readonly totalCost: number;
  /** Why this hull, in a sentence. */
  readonly whyThisShip: string;
  /** Anything the budget or the hull forced. */
  readonly compromises: readonly string[];
}

/**
 * How a role rates a module, and what it wants in each kind of slot.
 *
 * ★ RATINGS ARE NOT A QUALITY LADDER ★
 *
 * A is not "best". A-rated modules are the most capable and the HEAVIEST, and on an explorer that
 * makes them the wrong answer everywhere except the drive — a D-rated power plant on a long-range
 * ship is a deliberate, correct choice that an "always pick A" fitter would never make.
 */
interface RoleProfile {
  /** Ranked rating preference for the core modules, best first. */
  readonly corePreference: readonly string[];
  /** The drive is exempt from the core preference on ranges-first builds. */
  readonly driveRating: string;
  /** Module groups wanted in weapon hardpoints, in priority order. */
  readonly hardpoints: readonly string[];
  /** Module groups wanted in utility mounts. */
  readonly utilities: readonly string[];
  /**
   * Module groups wanted in internal bays, in priority order, with how many of each.
   *
   * ★ A COUNT, NOT A FLAG ★
   *
   * The first version had a boolean list of "groups you may fit several of", and collector limpet
   * controllers were on it — so they filled EVERY remaining bay on a mining ship and it came out
   * with a refinery, six collectors and zero cargo. A miner with nowhere to put the ore.
   *
   * How many of a thing a ship wants is a number per role, not a property of the module: a trader
   * wants every bay it can get as cargo, a miner wants one prospector and two collectors and then
   * cargo, and a combat fit wants a shield generator and no more.
   */
  readonly internals: ReadonlyArray<{ group: string; max: number; sizeToFit?: boolean }>;
  /** How to break ties between candidates for one slot. */
  readonly prefer: 'light' | 'capable';
  readonly describe: string;
}

const PROFILES: Readonly<Record<FitRole, RoleProfile>> = {
  /*
   * ★ MINING ★
   *
   * Lasers cut, the abrasion blaster takes surface deposits, the sub-surface displacement missile
   * opens seams, and the pulse wave analyser finds them. Without a REFINERY none of it is worth
   * anything — the ore stays as fragments — so the refinery is first among the internals, ahead of
   * cargo, which is the mistake a cargo-first ordering would make.
   */
  mining: {
    corePreference: ['D', 'E', 'C', 'B', 'A'],
    driveRating: 'A',
    hardpoints: ['ml', 'abl', 'sdm'],
    utilities: ['pwa', 'hs'],
    internals: [
      { group: 'rf', max: 1 },
      /*
       * ★ ONE HOLD BEFORE THE LIMPETS ★
       *
       * Cargo appears twice on purpose. A small hull has three or four bays, and a refinery plus a
       * prospector plus two collectors fills all of them — leaving a mining ship with nowhere to
       * put the ore, which is a complete build that cannot do the job it was fitted for.
       *
       * So one rack is claimed before the limpets, and the rest of the hold afterwards. On a big
       * hull nothing changes; on a small one it is the difference between a miner and an ornament.
       */
      { group: 'cr', max: 1 },
      { group: 'pc', max: 1 },
      { group: 'cc', max: 2 },
      // Sized to the hull for the same reason as the trader: ore capacity is the yield.
      { group: 'sg', max: 1, sizeToFit: true },
      // Everything left is hold. Cargo is the yield, so it takes whatever the tools do not need.
      { group: 'cr', max: 99 },
    ],
    prefer: 'light',
    describe: 'mining',
  },
  /*
   * ★ COMBAT ★
   *
   * A-rated throughout: the power distributor decides how long the guns keep firing and the plant
   * decides how much can be switched on at once, so lightness is the wrong trade here. Shields and
   * hull reinforcement before anything else in the bays.
   */
  combat: {
    corePreference: ['A', 'B', 'C', 'D', 'E'],
    driveRating: 'A',
    hardpoints: ['mc', 'pl', 'bl', 'c'],
    utilities: ['sb', 'ch', 'hs'],
    internals: [
      { group: 'sg', max: 1 },
      { group: 'scb', max: 1 },
      { group: 'mrp', max: 2 },
      { group: 'hr', max: 99 },
    ],
    prefer: 'capable',
    describe: 'combat',
  },
  /*
   * ★ EXPLORER ★
   *
   * D-rated everywhere except the drive, which is A. That is not a compromise — mass is the enemy
   * of jump range and a D-rated module is the lightest of its class, so a stripped hull with the
   * biggest drive it can carry is the correct answer and looks wrong to anybody reading ratings as
   * a quality scale.
   */
  explorer: {
    corePreference: ['D', 'E', 'C', 'B', 'A'],
    driveRating: 'A',
    hardpoints: [],
    utilities: ['hs'],
    internals: [
      // A fuel scoop is what makes a long trip possible at all; without one the range is one tank.
      { group: 'fs', max: 1 },
      { group: 'am', max: 1 },
      { group: 'sg', max: 1 },
      { group: 'pci', max: 1 },
    ],
    prefer: 'light',
    describe: 'exploration',
  },
  /*
   * ★ TRADER ★
   *
   * Cargo first and everything else as light as it can be, because every tonne of module is a tonne
   * of cargo not carried and a shorter jump between markets.
   */
  trader: {
    corePreference: ['D', 'E', 'C', 'B', 'A'],
    driveRating: 'A',
    hardpoints: [],
    utilities: ['sb'],
    internals: [
      /*
       * ★ SIZED TO THE HULL, NOT TO THE BIGGEST BAY ★
       *
       * A trader's shield generator used to claim the largest internal, because that is what the
       * assignment loop does. On a Python Mk II that meant a class 6 shield generator in the class
       * 6 bay and 32 t of cargo in what is sold as a trading ship.
       *
       * A shield generator has a maximum hull mass; above it the shields barely form. Below it,
       * bigger buys strength this role is not being scored on. So it takes the SMALLEST class that
       * still covers the hull, and the hold gets the class 6 bay — which is the whole point of
       * buying the ship.
       */
      { group: 'sg', max: 1, sizeToFit: true },
      { group: 'cr', max: 99 },
    ],
    prefer: 'light',
    describe: 'trading',
  },
};

function num(module: CatalogueModule, key: string): number {
  const value = module.raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Every module that physically fits this slot, respecting size and any restriction. */
function candidatesFor(
  catalogue: BuildCatalogue,
  slot: CatalogueSlot,
  groups: readonly string[],
): CatalogueModule[] {
  const category = categoryOf(slot);
  const found: CatalogueModule[] = [];

  for (const group of groups) {
    /*
     * ★ A RESTRICTED SLOT ACCEPTS ONLY WHAT IT SAYS ★
     *
     * The Type-11's hardpoints are mining-only and several hulls have limpet-only or fighter-only
     * bays. Fitting a beam laser into a mining mount produces a build that reads perfectly and
     * cannot be bought — the kind of answer that destroys trust in every other answer.
     */
    if (slot.eligible !== null && !slot.eligible.includes(group)) continue;

    for (const module of catalogue.modulesIn(category, group)) {
      // Bigger than the slot is not a candidate. SMALLER is fine and often right — under-filling is
      // how weight is saved.
      if (module.class > slot.size) continue;
      found.push(module);
    }
  }

  return found;
}

/**
 * Picks one module for one slot.
 *
 * Largest class that fits, then the role's rating preference, then the tie-break. Cost and power are
 * hard limits rather than preferences: a build that cannot be bought or cannot be switched on is not
 * a worse answer, it is a wrong one.
 */
function choose(
  candidates: readonly CatalogueModule[],
  profile: RoleProfile,
  limits: { credits: number; power: number },
  ratingOverride?: string,
): CatalogueModule | null {
  const affordable = candidates.filter(
    (m) => (m.cost ?? 0) <= limits.credits && (m.power ?? 0) <= limits.power,
  );
  if (affordable.length === 0) return null;

  const preference = ratingOverride === undefined ? profile.corePreference : [ratingOverride, ...profile.corePreference];

  return affordable.sort((a, b) => {
    // Class first: a bigger module of the same kind is more of what the slot is for.
    if (a.class !== b.class) return b.class - a.class;

    const aRank = preference.indexOf(a.rating ?? '');
    const bRank = preference.indexOf(b.rating ?? '');
    if (aRank !== bRank) return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank);

    // Then the role's own tie-break: lighter for range, heavier-and-more-capable for a fight.
    return profile.prefer === 'light' ? (a.mass ?? 0) - (b.mass ?? 0) : (b.mass ?? 0) - (a.mass ?? 0);
  })[0] ?? null;
}

/** Hull cost, from whichever field coriolis recorded it in. */
function hullCost(ship: CatalogueShip): number {
  const props = ship.properties;
  const cost = props['hullCost'] ?? props['retailCost'];
  return typeof cost === 'number' ? cost : 0;
}

/**
 * Fits one hull for one role.
 *
 * ★ CORE FIRST, THEN THE JOB, THEN WHAT IS LEFT ★
 *
 * The order matters and it is the order a human outfits in. A ship with no power plant is not a
 * ship, so the core is bought before anything optional; the role's own tools come next, because
 * they are the point; and cargo or reinforcement fills whatever remains. Spending the budget on
 * cargo racks first and finding there is nothing left for a drive is exactly the failure this
 * avoids.
 */
export function fitShip(ship: CatalogueShip, request: FitRequest, catalogue: BuildCatalogue): FitResult {
  const profile = PROFILES[request.role];
  const compromises: string[] = [];

  let credits = (request.budget ?? Number.MAX_SAFE_INTEGER) - hullCost(ship);
  if (credits < 0) {
    compromises.push(`The ${ship.name} hull alone is over budget.`);
    credits = 0;
  }

  const fitted = new Map<string, CatalogueModule>();

  /*
   * The power plant is bought first and never counted against the power budget — it is what
   * generates it. Everything after it is limited by what it makes.
   */
  const plantSlot = ship.slots.find((s) => s.fixedGroup === 'pp');
  const plant =
    plantSlot === undefined
      ? null
      : choose(candidatesFor(catalogue, plantSlot, ['pp']), profile, { credits, power: Infinity });

  if (plant !== null && plantSlot !== undefined) {
    fitted.set(`standard:${plantSlot.index}`, plant);
    credits -= plant.cost ?? 0;
  }

  let power = plant === null ? 0 : num(plant, 'pgen');

  const fill = (slot: CatalogueSlot, groups: readonly string[], ratingOverride?: string): boolean => {
    const module = choose(candidatesFor(catalogue, slot, groups), profile, { credits, power }, ratingOverride);
    if (module === null) return false;

    fitted.set(`${slot.group}:${slot.index}`, module);
    credits -= module.cost ?? 0;
    power -= module.power ?? 0;
    return true;
  };

  // The rest of the core, in the game's own order. Every one of these is mandatory.
  for (const slot of ship.slots) {
    if (slot.group !== 'standard' || slot.fixedGroup === null || slot.fixedGroup === 'pp') continue;

    const rating = slot.fixedGroup === 'fsd' ? profile.driveRating : undefined;
    if (!fill(slot, [slot.fixedGroup], rating)) {
      compromises.push(`Could not afford a ${slot.fixedGroup.toUpperCase()} for this hull.`);
    }
  }

  // The job: weapons, utilities, then the bays that make the role work.
  for (const slot of ship.slots) {
    if (slot.group === 'hardpoint' && slot.size > 0 && profile.hardpoints.length > 0) {
      fill(slot, profile.hardpoints);
    } else if (slot.group === 'hardpoint' && slot.size === 0 && profile.utilities.length > 0) {
      fill(slot, profile.utilities);
    }
  }

  /*
   * Internals are filled in the role's priority order rather than slot by slot: the refinery has to
   * reach a bay before cargo racks take them all, and the shield generator before hull
   * reinforcement. Going slot by slot would fill the biggest bay with whatever came first.
   */
  const internalSlots = ship.slots.filter((s) => s.group === 'internal').sort((a, b) => b.size - a.size);
  const usedInternals = new Set<number>();

  /*
   * The hull's own mass, which is what a shield generator has to cover. Modules add to it, so this
   * under-states the laden figure — deliberately: over-stating it would push every ship up a class
   * of shield generator and take the bay back, which is the behaviour being fixed.
   */
  const bareHullMass = typeof ship.properties['hullMass'] === 'number' ? ship.properties['hullMass'] : 0;

  /**
   * Does this module still do its job on this hull?
   *
   * Only mass-curve modules have an answer. A shield generator whose `maxmass` is under the hull's
   * mass produces almost nothing — the curve has already bottomed out — so it is not "adequate" at
   * any price. Everything else has no such limit and is adequate by definition.
   */
  const adequate = (module: CatalogueModule): boolean => {
    const maxmass = num(module, 'maxmass');
    return maxmass === 0 || maxmass >= bareHullMass;
  };

  for (const { group, max, sizeToFit } of profile.internals) {
    let placed = 0;

    /*
     * Smallest bay first when the module is sized to the hull, so the big bays stay free for the
     * bulk group behind it. Largest first otherwise, which is right for anything scored on capacity.
     */
    const order = sizeToFit === true ? [...internalSlots].reverse() : internalSlots;

    for (const slot of order) {
      if (placed >= max) break;
      if (usedInternals.has(slot.index)) continue;

      const candidates = candidatesFor(catalogue, slot, [group]);
      if (candidates.length === 0) continue;
      if (sizeToFit === true && !candidates.some(adequate)) continue;

      if (fill(slot, [group])) {
        usedInternals.add(slot.index);
        placed += 1;
      }
    }

    /*
     * A sized-to-fit module that found no adequate bay still gets the biggest one going. A trader
     * with no shield at all is worse than a trader with a shield that struggles, and silently
     * skipping it would look like the fitter forgot.
     */
    if (sizeToFit === true && placed === 0 && max > 0) {
      for (const slot of internalSlots) {
        if (usedInternals.has(slot.index)) continue;
        if (fill(slot, [group])) {
          usedInternals.add(slot.index);
          break;
        }
      }
    }
  }

  const modules: FittedModule[] = ship.slots.map((slot) => {
    const module = fitted.get(`${slot.group}:${slot.index}`);
    return {
      group: slot.group,
      index: slot.index,
      moduleId: module?.id ?? null,
      slotSize: slot.size,
      enabled: true,
      priority: 1,
      engineering: null,
    };
  });

  const build: ShipBuild = {
    shipId: ship.id,
    shipName: ship.name,
    buildName: `${ship.name} — ${profile.describe}`,
    source: 'coriolis',
    // Ours, and honest about it: this build was computed rather than shared by anybody.
    sourceUrl: `https://coriolis.io/outfit/${ship.id}`,
    bulkheadId: ship.bulkheads[0]?.id ?? 'Bs',
    modules,
  };

  const stats = computeStats(build, catalogue);
  const spent = [...fitted.values()].reduce((sum, m) => sum + (m.cost ?? 0), 0);

  if (stats?.powerDeficit === true) {
    compromises.push('Everything fitted cannot run at once — some modules need powering down.');
  }

  return {
    build,
    stats,
    totalCost: hullCost(ship) + spent,
    whyThisShip: `${ship.name}: ${ship.slots.filter((s) => s.group === 'internal').length} internal bays, ${ship.slots.filter((s) => s.group === 'hardpoint' && s.size > 0).length} weapon mounts.`,
    compromises,
  };
}

/**
 * Picks a hull and fits it.
 *
 * ★ EVERY AFFORDABLE HULL IS TRIED, NOT GUESSED AT ★
 *
 * Forty-seven hulls and one profile each is a few hundred lookups — cheap enough to do properly, and
 * the alternative is a hand-written table of "best ship for X" that is wrong the moment Frontier
 * ships a hull or changes a price.
 *
 * The winner is scored on what the ROLE actually cares about: cargo for a trader, jump range for an
 * explorer, damage for a fight. A single "best build" score across all roles would rank an Anaconda
 * top of everything.
 */
export function fitForRole(catalogue: BuildCatalogue, request: FitRequest): FitResult | null {
  const hulls =
    request.shipId === undefined
      ? catalogue.ships()
      : [catalogue.ship(request.shipId)].filter((s): s is CatalogueShip => s !== null);

  if (hulls.length === 0) return null;

  const affordable = hulls.filter(
    (ship) => request.budget === undefined || hullCost(ship) <= request.budget,
  );

  // Nothing affordable is a real answer and is reported as one, rather than by silently fitting the
  // cheapest hull and letting somebody discover the price afterwards.
  if (affordable.length === 0) return null;

  const scored = affordable
    .map((ship) => fitShip(ship, request, catalogue))
    .filter((fit) => request.budget === undefined || fit.totalCost <= request.budget);

  if (scored.length === 0) return null;

  const score = (fit: FitResult): number => {
    const s = fit.stats;
    if (s === null) return -Infinity;

    switch (request.role) {
      case 'trader':
        return s.cargoCapacity;
      case 'explorer':
        return s.jumpRange ?? 0;
      case 'combat':
        // Damage AND the ability to survive delivering it. A glass cannon is not a combat ship.
        return (s.dps ?? 0) + (s.shields ?? 0) / 50 + s.armour / 100;
      case 'mining':
        // Cargo is the yield, but only if the tools are aboard — a hold with no refinery mines
        // nothing, so a build that failed to fit one scores as if it had no hold.
        return fit.build.modules.some(
          (m) => m.moduleId !== null && catalogue.module('internal', m.moduleId)?.grp === 'rf',
        )
          ? s.cargoCapacity
          : 0;
    }
  };

  return scored.sort((a, b) => score(b) - score(a))[0] ?? null;
}
