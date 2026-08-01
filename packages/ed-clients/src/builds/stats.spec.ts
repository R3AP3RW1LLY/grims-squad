import { describe, expect, it } from 'vitest';
import { buildCatalogue, type RawModuleItem, type RawShipItem } from './catalogue.js';
import { computeStats } from './stats.js';
import type { ShipBuild, FittedModule } from '@grims/shared/ship-build';

/**
 * What a build actually does.
 *
 * ★ THE FIXTURE IS THE REAL SIDEWINDER ★
 *
 * Hull mass, armour and the stock drive copied from what the coriolis ingest holds. The drive is an
 * `Int_Hyperdrive_Overcharge_Size2_Class1` — an SCO — because that is what a Sidewinder actually
 * leaves the factory with now, and its optimal mass of 60 against the old drive's 48 is why the
 * stock jump range is 13.15 ly and not the ~8 ly that every older guide still quotes.
 *
 * That number was checked by hand against the drive's own four values before it was written down
 * here, precisely because it looked wrong.
 */

const SIDEWINDER: RawShipItem = {
  extKey: 'sidewinder',
  name: 'Sidewinder',
  data: {
    slots: { standard: [2, 2, 2, 1, 1, 1, 2], hardpoints: [], internal: [2, 2, 1] },
    defaults: { standard: ['2E', '2E', 'O3', '1E', '1E', '1E', '2C'], hardpoints: [], internal: ['02', null, null] },
    bulkheads: [{ id: 'Bs', grp: 'bh', name: 'Lightweight Alloy', mass: 0, hullboost: 0.8 }],
    properties: { hullMass: 25, baseArmour: 60, name: 'Sidewinder' },
  },
};

const MODULES: RawModuleItem[] = [
  { data: [{ id: 'p3', grp: 'pp', class: 2, rating: 'E', mass: 2.5, pgen: 6.4, symbol: 'Int_Powerplant_Size2_Class1' }] },
  { data: [{ id: 't3', grp: 't', class: 2, rating: 'E', mass: 2.5, power: 0.36, symbol: 'Int_Engine_Size2_Class1' }] },
  {
    data: [
      {
        id: 'O3',
        grp: 'fsd',
        class: 2,
        rating: 'E',
        mass: 2.5,
        power: 0.16,
        optmass: 60,
        maxfuel: 0.6,
        fuelmul: 0.008,
        fuelpower: 2,
        symbol: 'Int_Hyperdrive_Overcharge_Size2_Class1',
      },
    ],
  },
  { data: [{ id: 'l1', grp: 'ls', class: 1, rating: 'E', mass: 1.3, power: 0.32, symbol: 'Int_LifeSupport_Size1_Class1' }] },
  { data: [{ id: 'd1', grp: 'pd', class: 1, rating: 'E', mass: 1.3, power: 0.32, symbol: 'Int_PowerDistributor_Size1_Class1' }] },
  { data: [{ id: 's1', grp: 's', class: 1, rating: 'E', mass: 1.3, power: 0.16, symbol: 'Int_Sensors_Size1_Class1' }] },
  { data: [{ id: 'f2', grp: 'ft', class: 2, rating: 'C', mass: 2.5, fuel: 2, symbol: 'Int_FuelTank_Size2_Class3' }] },
  { data: [{ id: '02', grp: 'cr', class: 2, rating: 'E', mass: 0, cargo: 4, symbol: 'Int_CargoRack_Size2_Class1' }] },
  { data: [{ id: '26', grp: 'hr', class: 1, rating: 'E', mass: 2, hullreinforcement: 80, symbol: 'Int_HullReinforcement_Size1_Class1' }] },
];

const catalogue = buildCatalogue([SIDEWINDER], MODULES);

const slot = (group: FittedModule['group'], index: number, moduleId: string | null, size = 2): FittedModule => ({
  group,
  index,
  moduleId,
  slotSize: size,
  enabled: true,
  priority: 1,
  engineering: null,
});

const STOCK: ShipBuild = {
  shipId: 'sidewinder',
  shipName: 'Sidewinder',
  buildName: 'stock',
  source: 'coriolis',
  sourceUrl: 'https://coriolis.io/outfit/sidewinder',
  bulkheadId: 'Bs',
  modules: [
    slot('standard', 0, 'p3'),
    slot('standard', 1, 't3'),
    slot('standard', 2, 'O3'),
    slot('standard', 3, 'l1', 1),
    slot('standard', 4, 'd1', 1),
    slot('standard', 5, 's1', 1),
    slot('standard', 6, 'f2'),
    slot('internal', 0, '02'),
    slot('internal', 1, null),
    slot('internal', 2, null, 1),
  ],
};

describe('mass and capacity', () => {
  it('adds the hull, the modules and the bulkhead', () => {
    const stats = computeStats(STOCK, catalogue);
    expect(stats?.hullMass).toBe(25);
    expect(stats?.moduleMass).toBeCloseTo(13.9, 2);
    expect(stats?.unladenMass).toBeCloseTo(38.9, 2);
  });

  it('laden mass carries fuel AND cargo', () => {
    // 38.9 + 2 tonnes of fuel + 4 of cargo.
    expect(computeStats(STOCK, catalogue)?.ladenMass).toBeCloseTo(44.9, 2);
  });

  it('reads capacity off the tanks and racks', () => {
    const stats = computeStats(STOCK, catalogue);
    expect(stats?.fuelCapacity).toBe(2);
    expect(stats?.cargoCapacity).toBe(4);
  });
});

describe('jump range', () => {
  it('MANDATORY: matches the drive’s own four numbers', () => {
    /*
     * (optmass / mass) × (fuelBurned / fuelmul) ^ (1 / fuelpower)
     * (60 / 39.5)      × (0.6 / 0.008) ^ (1 / 2)                   = 13.15 ly
     *
     * The mass includes the fuel the jump BURNS: a ship cannot jump on an empty tank, and quoting
     * the range of one that could would be a figure nobody can ever achieve.
     */
    expect(computeStats(STOCK, catalogue)?.jumpRange).toBeCloseTo(13.15, 2);
  });

  it('laden is shorter', () => {
    const stats = computeStats(STOCK, catalogue);
    expect(stats?.ladenJumpRange).toBeLessThan(stats?.jumpRange ?? 0);
  });

  it('MANDATORY: no drive is null, never zero', () => {
    /*
     * A part-built ship with no drive is a real state. Zero would read as "this jumps nowhere",
     * which is a claim about a ship rather than an absence of one.
     */
    const noDrive: ShipBuild = { ...STOCK, modules: STOCK.modules.map((m) => (m.moduleId === 'O3' ? { ...m, moduleId: null } : m)) };
    expect(computeStats(noDrive, catalogue)?.jumpRange).toBeNull();
  });

  it('MANDATORY: a tank smaller than one jump limits the jump', () => {
    /*
     * A big drive on a tiny tank is limited by the tank. Reporting the drive's theoretical maximum
     * is wrong in the direction that strands people between stars.
     */
    const tiny: ShipBuild = { ...STOCK, modules: STOCK.modules.map((m) => (m.moduleId === 'f2' ? { ...m, moduleId: null } : m)) };
    expect(computeStats(tiny, catalogue)?.jumpRange).toBeNull();
  });
});

describe('power', () => {
  it('adds what the plant makes and what is drawn', () => {
    const stats = computeStats(STOCK, catalogue);
    expect(stats?.powerGenerated).toBe(6.4);
    expect(stats?.powerDrawn).toBeCloseTo(1.32, 2);
    expect(stats?.powerDeficit).toBe(false);
  });

  it('MANDATORY: a module switched off does not count against the budget', () => {
    /*
     * Somebody who has deliberately powered down a module to fit something else is not over budget.
     * Telling them they are would send them re-engineering a ship that already works.
     */
    const hungry: ShipBuild = {
      ...STOCK,
      modules: STOCK.modules.map((m) => (m.moduleId === 'p3' ? { ...m, moduleId: 'p3' } : m)),
    };
    const off = { ...hungry, modules: hungry.modules.map((m) => ({ ...m, enabled: m.moduleId !== 't3' })) };

    const on = computeStats(hungry, catalogue);
    const powered = computeStats(off, catalogue);
    expect(powered?.powerDrawn).toBeLessThan(on?.powerDrawn ?? 0);
  });
});

describe('armour', () => {
  it('applies the bulkhead boost to the base', () => {
    // 60 base × (1 + 0.8 lightweight boost) = 108.
    expect(computeStats(STOCK, catalogue)?.armour).toBe(108);
  });

  it('adds hull reinforcement', () => {
    const reinforced: ShipBuild = {
      ...STOCK,
      modules: STOCK.modules.map((m) => (m.group === 'internal' && m.index === 1 ? { ...m, moduleId: '26' } : m)),
    };
    expect(computeStats(reinforced, catalogue)?.armour).toBe(188);
  });
});

describe('a ship we do not know', () => {
  it('returns null rather than zeroes', () => {
    // Zeroes would render as a real ship with no mass and no armour, which is worse than a gap.
    expect(computeStats({ ...STOCK, shipId: 'nope' }, catalogue)).toBeNull();
  });
});
