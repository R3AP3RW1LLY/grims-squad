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
 * ★ WHAT THIS DELIBERATELY DOES NOT COMPUTE ★
 *
 * Shield strength and DPS. Both are genuinely involved — shields curve on the generator's optimal
 * mass and multiply through boosters with diminishing returns; DPS depends on rate of fire,
 * ammunition, distributor draw and engineering per weapon.
 *
 * Getting either subtly wrong produces a number that looks authoritative and is not, which the AI
 * would then repeat to a member deciding what to fly. Fewer numbers, each correct, beats a full
 * panel where two of them lie. They are named as absent rather than shown as zero.
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

  const baseArmour = typeof ship.properties['baseArmour'] === 'number' ? ship.properties['baseArmour'] : 0;
  const hullBoost = bulkhead === undefined ? 0 : raw(bulkhead, 'hullboost');
  const reinforcement = modules.filter((m) => m.grp === 'hr').reduce((sum, m) => sum + raw(m, 'hullreinforcement'), 0);

  const fittedCount = build.modules.filter((m) => m.moduleId !== null).length;

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
    unknownModules: fittedCount - modules.length,
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
