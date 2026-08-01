import { describe, expect, it } from 'vitest';
import { buildCatalogue, type RawModuleItem, type RawShipItem } from './catalogue.js';
import { fitForRole, fitShip } from './fit.js';

/**
 * Fitting a ship for a job.
 *
 * ★ THE PROPERTIES THAT MAKE AN ANSWER TRUSTWORTHY ★
 *
 * Every case here is one where a wrong result would still READ correctly — a miner with no
 * refinery, a hull over budget, a laser in a mining-only mount. Those are the failures that would
 * reach a member as a confident recommendation, and they are the reason the assistant calls this
 * rather than writing a loadout itself.
 */

const HAULER: RawShipItem = {
  extKey: 'hauler',
  name: 'Hauler',
  data: {
    edID: 1,
    // Class 3 throughout, so every fixture module physically fits — the sizes here are about
    // exercising the fitter, not about reproducing the real Hauler.
    slots: {
      standard: [3, 3, 3, 3, 3, 3, 3],
      hardpoints: [1, 0],
      internal: [4, 3, 2, 1],
    },
    defaults: { standard: [], hardpoints: [], internal: [] },
    bulkheads: [{ id: 'Bs', grp: 'bh', name: 'Lightweight Alloy', mass: 0, hullboost: 0.8 }],
    properties: { hullMass: 14, baseArmour: 40, baseShieldStrength: 50, hullCost: 1_000_000 },
  },
};

/** A hull whose only weapon mount is mining-only, like the Type-11 Prospector's. */
const PROSPECTOR: RawShipItem = {
  extKey: 'prospector',
  name: 'Prospector',
  data: {
    edID: 2,
    slots: {
      standard: [3, 3, 3, 3, 3, 3, 3],
      hardpoints: [{ name: 'Mining', class: 2, eligible: { ml: 1, abl: 1 } }],
      internal: [5, 4, 3],
    },
    defaults: { standard: [], hardpoints: [], internal: [] },
    bulkheads: [{ id: 'Bs', grp: 'bh', name: 'Lightweight Alloy', mass: 0, hullboost: 0.8 }],
    properties: { hullMass: 200, baseArmour: 200, baseShieldStrength: 150, hullCost: 5_000_000 },
  },
};

const core = (grp: string, id: string, cls: number, rating: string, extra: Record<string, unknown> = {}) => ({
  data: [{ id, grp, class: cls, rating, mass: cls, cost: cls * 10_000, power: 0.5, symbol: `${grp}${id}`, ...extra }],
});

const MODULES: RawModuleItem[] = [
  // Two ratings of every core module, so rating preference is testable.
  ...['pp', 't', 'fsd', 'ls', 'pd', 's', 'ft'].flatMap((grp) => [
    core(grp, `${grp}A`, 3, 'A', grp === 'pp' ? { pgen: 20, mass: 6 } : { mass: 6 }),
    core(grp, `${grp}D`, 3, 'D', grp === 'pp' ? { pgen: 12, mass: 2 } : { mass: 2 }),
  ]),
  { data: [{ id: 'fsdBig', grp: 'fsd', class: 3, rating: 'A', mass: 6, cost: 50_000, power: 0.5, optmass: 1000, maxfuel: 5, fuelmul: 0.01, fuelpower: 2, symbol: 'fsdBig' }] },
  { data: [{ id: 'tank', grp: 'ft', class: 3, rating: 'C', mass: 2, cost: 5_000, fuel: 16, symbol: 'tank' }] },

  { data: [{ id: 'rack4', grp: 'cr', class: 4, rating: 'E', mass: 0, cost: 20_000, cargo: 16, symbol: 'rack4' }] },
  { data: [{ id: 'rack3', grp: 'cr', class: 3, rating: 'E', mass: 0, cost: 10_000, cargo: 8, symbol: 'rack3' }] },
  { data: [{ id: 'rack2', grp: 'cr', class: 2, rating: 'E', mass: 0, cost: 5_000, cargo: 4, symbol: 'rack2' }] },
  { data: [{ id: 'rack1', grp: 'cr', class: 1, rating: 'E', mass: 0, cost: 2_000, cargo: 2, symbol: 'rack1' }] },

  { data: [{ id: 'refine', grp: 'rf', class: 3, rating: 'A', mass: 4, cost: 100_000, power: 0.4, symbol: 'refine' }] },
  { data: [{ id: 'collect', grp: 'cc', class: 3, rating: 'A', mass: 4, cost: 80_000, power: 0.4, symbol: 'collect' }] },
  { data: [{ id: 'prospect', grp: 'pc', class: 3, rating: 'A', mass: 4, cost: 60_000, power: 0.4, symbol: 'prospect' }] },
  { data: [{ id: 'laser', grp: 'ml', class: 2, rating: 'D', mount: 'F', mass: 2, cost: 30_000, power: 0.5, symbol: 'laser' }] },

  { data: [{ id: 'gun', grp: 'mc', class: 1, rating: 'F', mount: 'F', mass: 2, cost: 40_000, power: 0.3, damage: 5, fireint: 0.5, damagedist: { K: 1 }, symbol: 'gun' }] },
  { data: [{ id: 'shield', grp: 'sg', class: 4, rating: 'A', mass: 4, cost: 90_000, power: 1.5, minmass: 10, optmass: 60, maxmass: 200, minmul: 0.7, optmul: 1.2, maxmul: 1.7, symbol: 'shield' }] },
  { data: [{ id: 'scoop', grp: 'fs', class: 4, rating: 'A', mass: 4, cost: 70_000, power: 0.4, symbol: 'scoop' }] },
];

const catalogue = buildCatalogue([HAULER, PROSPECTOR], MODULES);

describe('fitting a hull', () => {
  it('always fits the full core — a ship without a drive is not a ship', () => {
    const fit = fitShip(catalogue.ship('hauler')!, { role: 'trader' }, catalogue);
    const core = fit.build.modules.filter((m) => m.group === 'standard');

    expect(core.every((m) => m.moduleId !== null)).toBe(true);
  });

  it('MANDATORY: a mining fit gets a refinery before cargo', () => {
    /*
     * Without a refinery the ore stays as fragments and the whole ship is pointless — but a
     * cargo-first ordering fills every bay and produces a hold with nothing to put in it, which
     * reads like a perfectly good miner.
     */
    const fit = fitShip(catalogue.ship('prospector')!, { role: 'mining' }, catalogue);
    const groups = fit.build.modules
      .filter((m) => m.moduleId !== null)
      .map((m) => catalogue.module('internal', m.moduleId ?? '')?.grp);

    expect(groups).toContain('rf');
  });

  it('MANDATORY: limpet controllers do not eat every bay', () => {
    /*
     * ★ THE BUG THIS EXISTS TO STOP, WHICH HAPPENED ★
     *
     * Collector controllers were on a list of "groups you may fit several of", so they filled every
     * remaining internal on a mining ship: a refinery, six collectors, and ZERO CARGO. A miner with
     * nowhere to put the ore, and it looked entirely reasonable in a list of modules.
     */
    const fit = fitShip(catalogue.ship('prospector')!, { role: 'mining' }, catalogue);
    const collectors = fit.build.modules.filter(
      (m) => m.moduleId !== null && catalogue.module('internal', m.moduleId)?.grp === 'cc',
    );

    expect(collectors.length).toBeLessThanOrEqual(2);
    expect(fit.stats?.cargoCapacity ?? 0).toBeGreaterThan(0);
  });

  it('MANDATORY: never fits a module a restricted slot forbids', () => {
    /*
     * The Prospector's only mount is mining-only. A multi-cannon in it produces a build that reads
     * perfectly and cannot be bought — the kind of answer that destroys trust in every other one.
     */
    const fit = fitShip(catalogue.ship('prospector')!, { role: 'combat' }, catalogue);
    const weapons = fit.build.modules.filter(
      (m) => m.group === 'hardpoint' && m.slotSize > 0 && m.moduleId !== null,
    );

    for (const w of weapons) {
      expect(catalogue.module('hardpoint', w.moduleId ?? '')?.grp).not.toBe('mc');
    }
  });

  it('an explorer prefers light modules, a combat fit prefers capable ones', () => {
    /*
     * A is not "best". A-rated is the most capable and the heaviest, and on a long-range ship that
     * makes it the wrong answer everywhere except the drive.
     */
    const explorer = fitShip(catalogue.ship('hauler')!, { role: 'explorer' }, catalogue);
    const combat = fitShip(catalogue.ship('hauler')!, { role: 'combat' }, catalogue);

    const plant = (fit: typeof explorer): string | null => {
      const m = fit.build.modules.find((x) => x.group === 'standard' && x.index === 0);
      return m?.moduleId === null || m?.moduleId === undefined
        ? null
        : (catalogue.module('standard', m.moduleId)?.rating ?? null);
    };

    expect(plant(explorer)).toBe('D');
    expect(plant(combat)).toBe('A');
  });
});

describe('budget', () => {
  it('MANDATORY: never returns a build over budget', () => {
    /*
     * The owner's use case is "give you a budget and have the AI tell them what ship to buy". A
     * recommendation somebody cannot afford is worse than no recommendation — they find out at the
     * shipyard.
     */
    const fit = fitForRole(catalogue, { role: 'trader', budget: 2_000_000 });
    expect(fit).not.toBeNull();
    expect(fit?.totalCost ?? Infinity).toBeLessThanOrEqual(2_000_000);
  });

  it('MANDATORY: nothing affordable is null, not the cheapest thing anyway', () => {
    // Silently fitting something over budget and letting somebody discover the price afterwards is
    // the one outcome a budget question must not produce.
    expect(fitForRole(catalogue, { role: 'trader', budget: 100 })).toBeNull();
  });

  it('a bigger budget is never a worse ship', () => {
    const small = fitForRole(catalogue, { role: 'trader', budget: 2_000_000 });
    const large = fitForRole(catalogue, { role: 'trader', budget: 50_000_000 });

    expect(large?.stats?.cargoCapacity ?? 0).toBeGreaterThanOrEqual(small?.stats?.cargoCapacity ?? 0);
  });

  it('honours a forced hull', () => {
    const fit = fitForRole(catalogue, { role: 'mining', shipId: 'prospector' });
    expect(fit?.build.shipId).toBe('prospector');
  });
});

describe('what it reports', () => {
  it('says why the hull, and what the budget cost', () => {
    const fit = fitForRole(catalogue, { role: 'trader', budget: 50_000_000 });

    expect(fit?.whyThisShip).toContain('internal bays');
    expect(fit?.totalCost).toBeGreaterThan(0);
  });

  it('MANDATORY: a power deficit is reported, not hidden', () => {
    /*
     * A build that cannot switch everything on is not a worse answer, it is a different one — and
     * the member has to be told, because the shipyard will not.
     */
    const fit = fitShip(catalogue.ship('prospector')!, { role: 'combat' }, catalogue);
    if (fit.stats?.powerDeficit === true) {
      expect(fit.compromises.join(' ')).toContain('cannot run at once');
    }
  });
});
