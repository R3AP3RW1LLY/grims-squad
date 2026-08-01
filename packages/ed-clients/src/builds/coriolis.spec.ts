import { describe, expect, it } from 'vitest';
import { buildCatalogue, type RawModuleItem, type RawShipItem } from './catalogue.js';
import { decodeCoriolis } from './coriolis.js';

/**
 * Reading a Coriolis build link.
 *
 * ★ THE FIXTURE IS THE REAL ADDER ★
 *
 * Slot layout, stock loadout and module ids copied from what the coriolis ingest actually holds,
 * and the link is one the squadron owner supplied on 2026-08-01. A toy fixture would have passed
 * every one of the bugs this file now pins — they were all found by decoding real data and reading
 * the output.
 */

const ADDER: RawShipItem = {
  extKey: 'adder',
  name: 'Adder',
  data: {
    slots: { standard: [3, 3, 3, 1, 2, 3, 3], hardpoints: [2, 1, 1, 0, 0], internal: [3, 3, 2, 2, 1, 1, 1, 1] },
    // Standard as CLASS+RATING, everything else as ids. Exactly as coriolis-data writes it.
    defaults: { standard: ['3E', '3E', '3E', '1E', '2E', '3E', '3C'], hardpoints: [0, 17, 17, 0, 0], internal: ['01', '44', '00', 0, '', 0, 0, '4F'] },
    bulkheads: [{ id: 'BC', grp: 'bh', name: 'Lightweight Alloy' }, { id: 'BD', grp: 'bh', name: 'Reinforced Alloy' }],
    properties: { hullMass: 35, name: 'Adder' },
  },
};

/** The Panther writes its stock DRIVE as an id, not as class+rating. Both dialects, one array. */
const PANTHER: RawShipItem = {
  extKey: 'panthermkii',
  name: 'Panther Clipper Mk II',
  data: {
    slots: { standard: [8, 8, 7, 5, 7, 5, 7], hardpoints: [], internal: [] },
    defaults: { standard: ['8E', '8E', 'FD', '5E', '7E', '5E', '7C'], hardpoints: [], internal: [] },
    bulkheads: [{ id: '72', grp: 'bh', name: 'Lightweight Alloy' }],
    properties: {},
  },
};

const MODULES: RawModuleItem[] = [
  { data: [{ id: 'p9', grp: 'pp', class: 3, rating: 'E', symbol: 'Int_Powerplant_Size3_Class1', mass: 1.3, power: 8 }] },
  { data: [{ id: 'py', grp: 'pp', class: 8, rating: 'E', symbol: 'Int_Powerplant_Size8_Class1' }] },
  { data: [{ id: 't9', grp: 't', class: 3, rating: 'E', symbol: 'Int_Engine_Size3_Class1' }] },
  { data: [{ id: 'ty', grp: 't', class: 8, rating: 'E', symbol: 'Int_Engine_Size8_Class1' }] },
  { data: [{ id: 'F9', grp: 'fsd', class: 3, rating: 'E', symbol: 'Int_Hyperdrive_Size3_Class1' }] },
  { data: [{ id: 'FD', grp: 'fsd', class: 7, rating: 'E', name: 'Frame Shift Drive (SCO)' }] },
  { data: [{ id: 'l4', grp: 'ls', class: 1, rating: 'E', symbol: 'Int_LifeSupport_Size1_Class1' }] },
  { data: [{ id: 'lo', grp: 'ls', class: 5, rating: 'E', symbol: 'Int_LifeSupport_Size5_Class1' }] },
  { data: [{ id: 'd9', grp: 'pd', class: 2, rating: 'E', symbol: 'Int_PowerDistributor_Size2_Class1' }] },
  { data: [{ id: 'dy', grp: 'pd', class: 7, rating: 'E', symbol: 'Int_PowerDistributor_Size7_Class1' }] },
  { data: [{ id: 'se', grp: 's', class: 3, rating: 'E', symbol: 'Int_Sensors_Size3_Class1' }] },
  { data: [{ id: 'so', grp: 's', class: 5, rating: 'E', symbol: 'Int_Sensors_Size5_Class1' }] },
  { data: [{ id: 'f3', grp: 'ft', class: 3, rating: 'C', symbol: 'Int_FuelTank_Size3_Class3' }] },
  { data: [{ id: 'f7', grp: 'ft', class: 7, rating: 'C', symbol: 'Int_FuelTank_Size7_Class3' }] },

  // ★ THE COLLISION. `F9` is a frame shift drive AND a fuel transfer limpet controller.
  { data: [{ id: 'F9', grp: 'fx', class: 3, rating: 'A', name: 'Fuel Transfer Limpet Controller' }] },

  { data: [{ id: '1b', grp: 'pl', class: 2, rating: 'F', mount: 'G', symbol: 'Hpt_PulseLaser_Gimbal_Medium' }] },
  { data: [{ id: '17', grp: 'pl', class: 1, rating: 'F', mount: 'F', symbol: 'Hpt_PulseLaser_Fixed_Small' }] },
  { data: [{ id: '00', grp: 'ch', class: 0, rating: 'I', name: 'Chaff Launcher' }] },
  { data: [{ id: '3y', grp: 'xs', class: 0, rating: 'C', name: 'Enhanced Xeno Scanner' }] },
  { data: [{ id: '01', grp: 'cr', class: 2, rating: 'E', symbol: 'Int_CargoRack_Size2_Class1' }] },
  { data: [{ id: '00', grp: 'cr', class: 1, rating: 'E', symbol: 'Int_CargoRack_Size1_Class1' }] },
  { data: [{ id: '44', grp: 'sg', class: 3, rating: 'E', symbol: 'Int_ShieldGenerator_Size3_Class1' }] },
  { data: [{ id: '4F', grp: 'pas', class: 1, rating: 'I', name: 'Advanced Planetary Approach Suite (Odyssey)' }] },
];

const catalogue = buildCatalogue([ADDER, PANTHER], MODULES);

/** The owner's link, verbatim. */
const ADDER_LINK =
  'https://coriolis.io/outfit/adder?code=A0p9t9F9l4d9sef31b1717003y014400----4F.Iw18UA%3D%3D.Aw18UA%3D%3D..EweloBhAOEDYQFMCGBzANokICMF8hRFA';

function fitted(url: string) {
  const result = decodeCoriolis(url, catalogue);
  if (!result.ok) throw new Error(result.problem);
  return result.build;
}

describe('a coded build link', () => {
  it('MANDATORY: the frame shift drive is a drive, not a limpet controller', () => {
    /*
     * ★ THE BUG THIS WHOLE FILE EXISTS FOR ★
     *
     * `F9` is `Int_Hyperdrive_Size3_Class1` in the `fsd` group and a Fuel Transfer Limpet Controller
     * in `fx`. 115 of 847 real ids collide like this. A flat id index returns whichever was indexed
     * last, and the resulting Adder — with a limpet controller where its drive should be — is
     * plausible, wrong, and invisible to anybody reading it.
     *
     * The lookup is scoped by the SLOT, and standard slot 2 is always the drive.
     */
    const build = fitted(ADDER_LINK);
    const drive = build.modules.find((m) => m.group === 'standard' && m.index === 2);

    expect(drive?.moduleId).toBe('F9');

    /*
     * ★ THE SAME ID IS BOTH MODULES, AND THAT IS THE POINT ★
     *
     * `F9` in a STANDARD slot is the drive. `F9` in an INTERNAL slot is genuinely the limpet
     * controller — a real module that really does live in an internal bay. Neither lookup is wrong;
     * what would be wrong is answering the same thing for both, which is what a flat index does.
     */
    expect(catalogue.module('standard', 'F9')?.grp).toBe('fsd');
    expect(catalogue.module('internal', 'F9')?.grp).toBe('fx');
  });

  it('reads every standard slot', () => {
    const std = fitted(ADDER_LINK).modules.filter((m) => m.group === 'standard');
    expect(std.map((m) => m.moduleId)).toEqual(['p9', 't9', 'F9', 'l4', 'd9', 'se', 'f3']);
  });

  it('reads weapons and utilities from the one hardpoint array', () => {
    // Coriolis keeps utility mounts in `hardpoints` as class 0. A chaff launcher must not be looked
    // up among the weapons, and a pulse laser must not be looked up among the utilities.
    const hp = fitted(ADDER_LINK).modules.filter((m) => m.group === 'hardpoint');
    expect(hp.map((m) => m.moduleId)).toEqual(['1b', '17', '17', '00', '3y']);
    expect(catalogue.module('utility', '00')?.name).toBe('Chaff Launcher');
    expect(catalogue.module('internal', '00')?.symbol).toBe('Int_CargoRack_Size1_Class1');
  });

  it('an empty slot is empty, not missing', () => {
    const build = fitted(ADDER_LINK);
    const empties = build.modules.filter((m) => m.moduleId === null);
    expect(empties.length).toBeGreaterThan(0);
  });

  it('reads the bulkhead index', () => {
    // `A0…` — format version A, bulkhead 0.
    expect(fitted(ADDER_LINK).bulkheadId).toBe('BC');
  });

  it('MANDATORY: a short code leaves later slots empty rather than shifting everything', () => {
    /*
     * Frontier adds slots to ships, so a link written last year carries fewer ids than the hull now
     * has — the owner's Adder link has six internal ids against eight slots. Running out is safe:
     * the extra slots come back empty. Stretching the ids to fill them would move every module after
     * the gap into the wrong slot and produce a build that reads perfectly.
     */
    const internal = fitted(ADDER_LINK).modules.filter((m) => m.group === 'internal');

    expect(internal).toHaveLength(8);
    expect(internal[0]?.moduleId).toBe('01');
    expect(internal[1]?.moduleId).toBe('44');
    expect(internal[2]?.moduleId).toBe('00');
    expect(internal.at(-1)?.moduleId).toBeNull();
  });
});

describe('a bare outfit link is the stock ship', () => {
  it('decodes with no code at all', () => {
    const build = fitted('https://coriolis.io/outfit/adder');
    expect(build.buildName).toBe('Adder — stock');
    expect(build.modules.filter((m) => m.group === 'standard').map((m) => m.moduleId)).toEqual([
      'p9', 't9', 'F9', 'l4', 'd9', 'se', 'f3',
    ]);
  });

  it('MANDATORY: stock standard slots are class+rating, not ids', () => {
    /*
     * `defaults.standard` is `["3E","3E","3E",…]` while the URL code for the same seven slots writes
     * `p9 t9 F9 …`. Two encodings in one file. Read through the id index alone, every stock ship
     * came back with no power plant, no thrusters and no drive — silently.
     */
    expect(catalogue.module('standard', '3E')).toBeNull();
    expect(catalogue.standardByRating('pp', 3, 'E')?.id).toBe('p9');
  });

  it('MANDATORY: and sometimes they are ids after all', () => {
    /*
     * The Panther Clipper Mk II writes `FD` for its stock drive — an id — because its factory fit is
     * an SCO drive with no plain class/rating twin. Forcing class+rating lost it; forcing ids lost
     * every other ship's whole standard row. Both are tried.
     */
    const build = fitted('https://coriolis.io/outfit/panthermkii');
    const std = build.modules.filter((m) => m.group === 'standard');

    expect(std.map((m) => m.moduleId)).toEqual(['py', 'ty', 'FD', 'lo', 'dy', 'so', 'f7']);
    expect(std.every((m) => m.moduleId !== null)).toBe(true);
  });
});

describe('stock loadouts with ragged data', () => {
  /*
   * ★ THE BUG THE SQUADRON OWNER SPOTTED, 2026-08-01 ★
   *
   * "check the cargo levels on the imported builds they do not seem right especially the panther
   * clipper ... 32t seems really low even for the stock build!"
   *
   * It was 32 t on a hauler whose first bay is a class 8. `defaults` used to be flattened into one
   * array — standard ++ hardpoints ++ internal — and mapped index-to-index against the slots
   * flattened the same way. That is correct only while every array is the same length on both
   * sides, and TEN of the 141 arrays in coriolis-data are not.
   *
   * The Panther lists more hardpoint slots than hardpoint defaults, so every internal default
   * shifted left: a class 5 rack from a later position landed in the class 8 bay. Nothing errored.
   * The build was simply the right modules in the wrong holes, and it read perfectly.
   */
  const RAGGED: RawShipItem = {
    extKey: 'ragged',
    name: 'Ragged',
    data: {
      // Four hardpoint slots, but only TWO defaults — exactly the Panther's shape.
      slots: { standard: [3], hardpoints: [2, 1, 0, 0], internal: [5, 2] },
      defaults: { standard: ['3E'], hardpoints: ['1b', '17'], internal: ['bigRack', 'smallRack'] },
      bulkheads: [{ id: 'BC', grp: 'bh', name: 'Lightweight Alloy' }],
      properties: { hullMass: 100 },
    },
  };

  const raggedCatalogue = buildCatalogue(
    [RAGGED],
    [
      ...MODULES,
      { data: [{ id: 'bigRack', grp: 'cr', class: 5, rating: 'E', cargo: 32, symbol: 'Int_CargoRack_Size5_Class1' }] },
      { data: [{ id: 'smallRack', grp: 'cr', class: 2, rating: 'E', cargo: 4, symbol: 'Int_CargoRack_Size2_Class1' }] },
      { data: [{ id: 'p3', grp: 'pp', class: 3, rating: 'E', symbol: 'Int_Powerplant_Size3_Class1' }] },
    ],
  );

  it('MANDATORY: a short defaults array does not shift the groups after it', () => {
    const result = decodeCoriolis('https://coriolis.io/outfit/ragged', raggedCatalogue);
    if (!result.ok) throw new Error(result.problem);

    const internals = result.build.modules.filter((m) => m.group === 'internal');

    // The BIG rack belongs in the big bay. Flattened, it would have landed two positions earlier.
    expect(internals[0]?.moduleId).toBe('bigRack');
    expect(internals[1]?.moduleId).toBe('smallRack');
  });

  it('the slots with no default are simply empty', () => {
    const result = decodeCoriolis('https://coriolis.io/outfit/ragged', raggedCatalogue);
    if (!result.ok) throw new Error(result.problem);

    const hardpoints = result.build.modules.filter((m) => m.group === 'hardpoint');
    expect(hardpoints).toHaveLength(4);
    expect(hardpoints[2]?.moduleId).toBeNull();
    expect(hardpoints[3]?.moduleId).toBeNull();
  });
});

describe('links we cannot read', () => {
  it('names the ship we do not have', () => {
    // Almost always a hull released since our last coriolis refresh. "We do not know the X yet" is
    // actionable; "invalid link" sends somebody to re-check a URL they copied correctly.
    const result = decodeCoriolis('https://coriolis.io/outfit/starfighter9000', catalogue);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain('starfighter9000');
  });

  it('says so when the link names no ship', () => {
    const result = decodeCoriolis('https://coriolis.io/outfit', catalogue);
    expect(result.ok).toBe(false);
  });

  it('junk is a sentence, not an exception', () => {
    const result = decodeCoriolis('not a link', catalogue);
    expect(result.ok).toBe(false);
  });
});
