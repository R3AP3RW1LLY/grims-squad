import type { ShipBuild } from '@grims/shared/ship-build';
import { categoryOf, type BuildCatalogue, type CatalogueModule } from './catalogue.js';

/**
 * What a build actually does, computed from what is fitted.
 *
 * ★ THE NUMBERS PEOPLE ASK FOR ★
 *
 * Nobody asks "what modules are on that Anaconda". They ask how far it jumps, whether it can power
 * everything, how much it carries and whether it will survive. Those are the answers the AI needs,
 * and none of them are in the build — they are computed from it.
 *
 * ★ SHIELDS AND DPS ARE HERE NOW, AND WHY THEY WERE NOT ★
 *
 * The first version left both out on the grounds that they are involved enough to get subtly wrong,
 * and a wrong number the assistant repeats is worse than a missing one.
 *
 * They are in because the data turned out to carry everything they need. A shield generator records
 * `minmul/optmul/maxmul` against `minmass/optmass/maxmass`, which is the whole curve; a booster
 * records `shieldboost`; and every weapon records `damage`, `fireint` and its `damagedist` split.
 * None of it is estimated.
 *
 * What is still absent is SUSTAINED dps — the figure that depends on the distributor draining under
 * continuous fire. `distdraw` and the distributor's `wepcap`/`weprate` are both present, so it is
 * computable, but the interaction with trigger discipline is a modelling choice rather than a
 * calculation, and this reports what the guns do rather than what a pilot does with them.
 */

export interface BuildStats {
  /** Hull, before anything is fitted. */
  readonly hullMass: number;
  /** Everything bolted on, including the bulkhead. */
  readonly moduleMass: number;
  /** Hull plus modules, no fuel and no cargo. */
  readonly unladenMass: number;
  /** Unladen plus a full tank and a full hold — the mass it jumps at, at worst. */
  readonly ladenMass: number;

  readonly fuelCapacity: number;
  readonly cargoCapacity: number;

  /** What the power plant makes. */
  readonly powerGenerated: number;
  /** What everything switched on wants. */
  readonly powerDrawn: number;
  /** True when the plant cannot run everything that is enabled. */
  readonly powerDeficit: boolean;

  /**
   * Best single jump, empty tank aside — unladen mass with one jump's worth of fuel.
   *
   * Null when there is no drive fitted, which is a real state for a part-built ship and must not
   * read as "jumps zero light years".
   */
  readonly jumpRange: number | null;
  /** The same jump at laden mass. What it does on a trade run. */
  readonly ladenJumpRange: number | null;

  /** Hull integrity: base armour, the bulkhead's boost, and any reinforcement. */
  readonly armour: number;

  /**
   * Top speed and boost in metres per second, at unladen mass.
   *
   * Null when no thrusters are fitted. Zero would describe a ship that has drives and cannot move,
   * which is a different — and much more alarming — claim than "nothing is fitted yet".
   */
  readonly speed: number | null;
  readonly boostSpeed: number | null;

  /**
   * Shield strength in megajoules. Null when no generator is fitted, which is a real build.
   *
   * A shieldless ship is a deliberate choice — explorers and some miners fly one — so zero would be
   * a claim about a broken build rather than a description of an intentional one.
   */
  readonly shields: number | null;

  /**
   * Burst damage per second, with everything firing.
   *
   * Null when nothing is armed. What a ship "does" in a fight over time is lower and depends on the
   * distributor and on trigger discipline — see the note at the top.
   */
  readonly dps: number | null;
  /** The same figure split by damage type, for reading against a target's resistances. */
  readonly damageByType: Readonly<Record<string, number>> | null;

  /** Modules that could not be priced or weighed, so the totals are known to be short. */
  readonly unknownModules: number;
}

function moduleOf(build: ShipBuild, catalogue: BuildCatalogue): CatalogueModule[] {
  const ship = catalogue.ship(build.shipId);
  if (ship === null) return [];

  const found: CatalogueModule[] = [];
  for (const fitted of build.modules) {
    if (fitted.moduleId === null) continue;
    const slot = ship.slots.find((s) => s.group === fitted.group && s.index === fitted.index);
    if (slot === undefined) continue;
    const module = catalogue.module(categoryOf(slot), fitted.moduleId);
    if (module !== null) found.push(module);
  }
  return found;
}

function raw(module: CatalogueModule, key: string): number {
  const value = module.raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The jump, from the drive's own four numbers.
 *
 *   range = (optimalMass / mass) × (fuelUsed / fuelMultiplier) ^ (1 / fuelPower)
 *
 * All four are on the module — a class 5A drive carries optmass 1050, maxfuel 5, fuelmul 0.012,
 * fuelpower 2.45 — so nothing here is a constant somebody has to keep current when Frontier
 * rebalances a drive.
 *
 * `fuelUsed` is the smaller of what the drive can burn in one jump and what the tank holds. A ship
 * with a large drive and a tiny tank is limited by the tank, and reporting the drive's theoretical
 * maximum for it would be wrong in the direction that strands people.
 */
function jumpOf(drive: CatalogueModule | undefined, mass: number, fuel: number): number | null {
  if (drive === undefined) return null;

  const optmass = raw(drive, 'optmass');
  const fuelmul = raw(drive, 'fuelmul');
  const fuelpower = raw(drive, 'fuelpower');
  const maxfuel = raw(drive, 'maxfuel');

  // A drive missing any of them is a drive we cannot compute from. Null, never a guess.
  if (optmass <= 0 || fuelmul <= 0 || fuelpower <= 0 || maxfuel <= 0 || mass <= 0) return null;

  const burn = Math.min(maxfuel, fuel);
  if (burn <= 0) return null;

  return (optmass / mass) * Math.pow(burn / fuelmul, 1 / fuelpower);
}

/**
 * The shield multiplier for a hull of this mass.
 *
 * ★ A TWO-PIECE CURVE, NOT A RATIO ★
 *
 * A generator has three mass points and three multipliers. Below optimal it interpolates from
 * `minmul` up to `optmul`; above it, down towards `maxmul` — and the two halves have different
 * gradients, which is exactly why a single `optmass / mass` ratio (the shape the JUMP calculation
 * uses) is wrong here and would flatter every overweight ship.
 *
 * Clamped at both ends: past `maxmass` the generator does not fail gracefully, it stops working,
 * and reporting a multiplier below `maxmul` would describe a shield that does not exist.
 */
function massCurve(module: CatalogueModule, mass: number): number {
  const minMass = raw(module, 'minmass');
  const optMass = raw(module, 'optmass');
  const maxMass = raw(module, 'maxmass');
  const minMul = raw(module, 'minmul');
  const optMul = raw(module, 'optmul');
  const maxMul = raw(module, 'maxmul');

  if (optMass <= 0 || maxMass <= minMass) return 0;

  if (mass <= minMass) return minMul;
  if (mass >= maxMass) return maxMul;

  return mass <= optMass
    ? minMul + ((mass - minMass) / (optMass - minMass)) * (optMul - minMul)
    : optMul + ((mass - optMass) / (maxMass - optMass)) * (maxMul - optMul);
}

/**
 * How fast the ship actually moves.
 *
 * ★ THE SAME CURVE AS THE SHIELDS, BECAUSE IT IS THE SAME CURVE ★
 *
 * Thrusters carry `minmass/optmass/maxmass` and `minmul/optmul/maxmul` exactly as generators do, and
 * the game reads them the same way — which is why `massCurve` is shared rather than copied. An
 * overweight ship is slow for the same reason it is under-shielded.
 *
 * Reported at UNLADEN mass, matching what an outfitting screen means by "speed": the figure that
 * describes the ship, not the figure it manages on a full trade run. Laden mass moves both numbers
 * down together and the laden jump range is already on the readout to make the trade visible.
 */
function driveSpeeds(
  thrusters: CatalogueModule | null,
  properties: Readonly<Record<string, unknown>>,
  mass: number,
): { speed: number | null; boost: number | null } {
  const base = typeof properties['speed'] === 'number' ? properties['speed'] : 0;
  const baseBoost = typeof properties['boost'] === 'number' ? properties['boost'] : 0;

  // No drive is a real state for a part-built ship. Null, not zero — zero is a claim that it is
  // fitted and cannot move.
  if (thrusters === null || base <= 0) return { speed: null, boost: null };

  const multiplier = massCurve(thrusters, mass);
  if (multiplier <= 0) return { speed: null, boost: null };

  return {
    speed: Math.round(base * multiplier),
    boost: baseBoost <= 0 ? null : Math.round(baseBoost * multiplier),
  };
}

/**
 * What the boosters add.
 *
 * ★ DIMINISHING RETURNS ARE THE POINT ★
 *
 * Six boosters do not add six times one booster. The game applies an exponential falloff, so the
 * fourth is worth noticeably less than the first — and a build that stacks them is making a
 * deliberate trade the naive sum would hide, reporting a shield strength no ship achieves.
 */
function boosterMultiplier(boosters: readonly CatalogueModule[]): number {
  if (boosters.length === 0) return 1;

  // Strongest first: the falloff is applied by POSITION, so ordering decides the answer.
  const boosts = boosters
    .map((b) => raw(b, 'shieldboost'))
    .filter((b) => b > 0)
    .sort((a, b) => b - a);

  let total = 1;
  boosts.forEach((boost, index) => {
    total += boost * Math.pow(0.7, index);
  });
  return total;
}

export function computeStats(build: ShipBuild, catalogue: BuildCatalogue): BuildStats | null {
  const ship = catalogue.ship(build.shipId);
  if (ship === null) return null;

  const modules = moduleOf(build, catalogue);
  const bulkhead = ship.bulkheads.find((b) => b.id === build.bulkheadId) ?? ship.bulkheads[0];

  const hullMass = typeof ship.properties['hullMass'] === 'number' ? ship.properties['hullMass'] : 0;
  const moduleMass =
    modules.reduce((sum, m) => sum + (m.mass ?? 0), 0) + (bulkhead?.mass ?? 0);

  const fuelCapacity = modules.filter((m) => m.grp === 'ft').reduce((sum, m) => sum + raw(m, 'fuel'), 0);
  const cargoCapacity = modules.filter((m) => m.grp === 'cr').reduce((sum, m) => sum + raw(m, 'cargo'), 0);

  const unladenMass = hullMass + moduleMass;
  const ladenMass = unladenMass + fuelCapacity + cargoCapacity;

  const powerGenerated = modules.filter((m) => m.grp === 'pp').reduce((sum, m) => sum + raw(m, 'pgen'), 0);

  /*
   * Only what is SWITCHED ON counts against the plant.
   *
   * A member who has deliberately powered down a mining laser to fit a shield is not over budget,
   * and telling them they are would send them re-engineering a ship that already works.
   */
  const ship_ = ship;
  const powerDrawn = build.modules
    .filter((f) => f.enabled && f.moduleId !== null)
    .reduce((sum, f) => {
      const slot = ship_.slots.find((s) => s.group === f.group && s.index === f.index);
      if (slot === undefined || f.moduleId === null) return sum;
      return sum + (catalogue.module(categoryOf(slot), f.moduleId)?.power ?? 0);
    }, 0);

  const drive = modules.find((m) => m.grp === 'fsd');
  const thrusters = modules.find((m) => m.grp === 't') ?? null;

  const baseArmour = typeof ship.properties['baseArmour'] === 'number' ? ship.properties['baseArmour'] : 0;
  const hullBoost = bulkhead === undefined ? 0 : raw(bulkhead, 'hullboost');
  const reinforcement = modules.filter((m) => m.grp === 'hr').reduce((sum, m) => sum + raw(m, 'hullreinforcement'), 0);

  const fittedCount = build.modules.filter((m) => m.moduleId !== null).length;

  /*
   * ★ SHIELDS CURVE ON UNLADEN MASS ★
   *
   * The generator sizes itself against the HULL, not against what is in the hold — a full cargo bay
   * does not weaken the shield. Using laden mass would under-report every trader.
   */
  const generator = modules.find((m) => m.grp === 'sg' || m.grp === 'bsg' || m.grp === 'psg');
  const baseShield =
    typeof ship.properties['baseShieldStrength'] === 'number'
      ? ship.properties['baseShieldStrength']
      : 0;

  const shields =
    generator === undefined || baseShield <= 0
      ? null
      : Math.round(
          baseShield *
            massCurve(generator, unladenMass) *
            boosterMultiplier(modules.filter((m) => m.grp === 'sb')),
        );

  /*
   * ★ DAMAGE PER SECOND, AND BY TYPE ★
   *
   * `damage / fireint` per weapon. `damagedist` splits it — a beam laser is entirely thermal, a
   * multi-cannon entirely kinetic, and plenty of things are a mixture. Keeping the split is what
   * lets an answer say "mostly thermal, so it will struggle against a hull-tanked target" instead
   * of quoting one number that hides the whole question.
   */
  const weapons = modules.filter((m) => raw(m, 'damage') > 0 && raw(m, 'fireint') > 0);

  const damageByType: Record<string, number> = {};
  let dps = 0;

  for (const weapon of weapons) {
    const rate = raw(weapon, 'damage') / raw(weapon, 'fireint');
    dps += rate;

    const split = weapon.raw['damagedist'];
    const shares =
      typeof split === 'object' && split !== null
        ? (split as Record<string, number>)
        : /*
           * No distribution recorded means the module is single-type and coriolis did not bother to
           * say so. Filed as `unknown` rather than silently dropped: a weapon whose type we cannot
           * name still contributes damage, and losing it would under-report the ship.
           */
          { unknown: 1 };

    for (const [type, share] of Object.entries(shares)) {
      if (typeof share !== 'number') continue;
      damageByType[type] = (damageByType[type] ?? 0) + rate * share;
    }
  }

  for (const type of Object.keys(damageByType)) {
    damageByType[type] = Math.round((damageByType[type] ?? 0) * 100) / 100;
  }

  const speeds = driveSpeeds(thrusters, ship.properties, unladenMass);

  return {
    hullMass,
    moduleMass: Math.round(moduleMass * 100) / 100,
    unladenMass: Math.round(unladenMass * 100) / 100,
    ladenMass: Math.round(ladenMass * 100) / 100,
    fuelCapacity,
    cargoCapacity,
    powerGenerated: Math.round(powerGenerated * 100) / 100,
    powerDrawn: Math.round(powerDrawn * 100) / 100,
    powerDeficit: powerDrawn > powerGenerated,
    /*
     * Unladen jump carries the fuel it BURNS — a ship cannot jump on an empty tank, and reporting
     * the range of one that could would be a number nobody can ever achieve.
     *
     * `drive === undefined` short-circuits rather than being cast into a fake module. The first
     * version wrote `raw(drive ?? {} as CatalogueModule, 'maxfuel')`, which crashed the whole stats
     * computation for any part-built ship with no drive fitted — caught by the test for exactly
     * that case, which was written expecting a null and got an exception.
     */
    jumpRange:
      drive === undefined
        ? null
        : round(jumpOf(drive, unladenMass + Math.min(fuelCapacity, raw(drive, 'maxfuel')), fuelCapacity)),
    ladenJumpRange: round(jumpOf(drive, ladenMass, fuelCapacity)),
    armour: Math.round(baseArmour * (1 + hullBoost) + reinforcement),
    speed: speeds.speed,
    boostSpeed: speeds.boost,
    shields,
    // Null rather than zero for an unarmed ship: a trader carrying no guns is a choice, not a
    // gunship that does nothing.
    dps: weapons.length === 0 ? null : Math.round(dps * 100) / 100,
    damageByType: weapons.length === 0 ? null : damageByType,
    unknownModules: fittedCount - modules.length,
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
