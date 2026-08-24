import { describe, expect, it } from 'vitest';
import { describeRavenImport, readRavenExport } from './raven-import.js';

/**
 * Reading a Raven Colonial export.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "in raven colonial, we can export a json file with a users build plan, can we take this file ...
 * and generate a new colonization plan"
 *
 * ★ THE FIXTURE IS THE REAL FILE ★
 *
 * Trimmed to the shapes that matter, but every field spelled exactly as
 * `backup_Col 285 Sector GL-W c2-12_#6_PebbleMerchant.json` spells it. A fixture invented from the
 * documentation would agree with my reading of the format rather than with Raven.
 */

const REAL = {
  v: 6,
  rev: 6,
  name: 'Col 285 Sector GL-W c2-12',
  id64: 3382588805794,
  architect: 'PEBBLEMERCAHNT',
  pos: [108.1875, 55.1875, -236.125],
  reserveLevel: 'pristine',
  bodies: [
    {
      name: 'Col 285 Sector GL-W c2-12 A',
      num: 1,
      distLS: 0,
      type: 'st',
      subType: 'K (Yellow-Orange) Star',
      features: [],
      radius: -1,
      temp: 4829,
      gravity: -1,
    },
    {
      name: 'Col 285 Sector GL-W c2-12 A 1',
      num: 9,
      distLS: 864.201102,
      type: 'gg',
      subType: 'Class II gas giant',
      features: ['rings'],
      radius: 70738.952,
      temp: 175.081726,
      gravity: 2.06893290506781,
    },
    {
      name: 'Col 285 Sector GL-W c2-12 A 1 f',
      num: 18,
      distLS: 861.125332,
      type: 'ib',
      subType: 'Icy body',
      features: ['landable', 'tidal'],
      radius: 1863.01475,
      temp: 133.226761,
      gravity: 0.111105944733354,
    },
  ],
  sites: [
    { id: 'x1786683848683', name: 'Primary port', bodyNum: 56, buildType: 'dec_truss', status: 'complete' },
    { id: 'x1786723337652', name: 'MAKUTO DRILLING RIGS', bodyNum: 18, buildType: 'ourea', status: 'complete' },
    { id: 'x1786723919069', name: 'KULKARNI ARMS FACILITY', bodyNum: 17, buildType: 'minerva', status: 'build' },
  ],
  slots: { '1': [1, -1], '9': [1, -1], '17': [1, 2], '18': [3, 2], '100100': [1, -1] },
  deleteIDs: [],
  updateIDs: [],
  pop: null,
  open: false,
};

describe('reading a Raven export', () => {
  it('★ MANDATORY: the slot counts are [orbital, surface] ★', () => {
    /*
     * ★ CONFIRMED AGAINST TRUTH, NOT ASSUMED FROM THE SHAPE ★
     *
     * An earlier session verified the Elite journal never emits architect-view slot counts, and
     * concluded manual entry was unavoidable. This file has them — so the limit was narrower than
     * recorded.
     *
     * Checked against production before the parser was written: our own rows for this exact system,
     * typed by hand by a member weeks earlier, say body 17 is (1, 2) and body 18 is (3, 2). The file
     * says the same. Two independent sources agreeing is what makes this reading a fact.
     */
    const file = readRavenExport(REAL);

    expect(file?.slots).toContainEqual({ bodyNum: 17, orbital: 1, surface: 2 });
    expect(file?.slots).toContainEqual({ bodyNum: 18, orbital: 3, surface: 2 });
  });

  it('★ MANDATORY: -1 is "not applicable", never minus one ★', () => {
    /*
     * A star has no surface, so Raven writes -1. Taken literally that is a negative slot count in a
     * plan checker and a negative gravity in a system summary — both of which would render, and
     * both of which would be nonsense.
     */
    const file = readRavenExport(REAL);

    const star = file?.slots.find((s) => s.bodyNum === 1);
    expect(star?.orbital).toBe(1);
    expect(star?.surface, 'a star has no surface').toBeNull();

    expect(file?.bodies.find((b) => b.bodyNum === 1)?.gravity, 'nor a measured gravity').toBeNull();
  });

  it('★ MANDATORY: buildType is a build_type_id, carried through untouched ★', () => {
    /*
     * The owner corrected me on this directly: "silenus is not a name, its the built_type_id". These
     * map onto our catalogue, so mangling or prettifying them here would break the join.
     */
    const file = readRavenExport(REAL);

    expect(file?.sites.map((s) => s.buildTypeId)).toEqual(['dec_truss', 'ourea', 'minerva']);
  });

  it('★ MANDATORY: an unrecognised status falls to PLANNED, not complete ★', () => {
    /*
     * The safe direction. A site wrongly called planned is corrected by a member in a moment; one
     * wrongly called complete is treated as immovable by the drafter and silently designed around.
     */
    const file = readRavenExport({
      ...REAL,
      sites: [{ id: 'x', name: 'n', bodyNum: 1, buildType: 'ourea', status: 'something-new' }],
    });

    expect(file?.sites[0]?.status).toBe('planned');
  });

  it('maps Raven’s two known statuses', () => {
    const file = readRavenExport(REAL);
    expect(file?.sites.map((s) => s.status)).toEqual(['complete', 'complete', 'building']);
  });

  it('reads landable and ringed off the features list', () => {
    const file = readRavenExport(REAL);

    expect(file?.bodies.find((b) => b.bodyNum === 18)?.isLandable).toBe(true);
    expect(file?.bodies.find((b) => b.bodyNum === 9)?.hasRings).toBe(true);
    expect(file?.bodies.find((b) => b.bodyNum === 9)?.isLandable).toBe(false);
  });

  it('keeps id64 as a string, because it outgrows a double', () => {
    // Ids in this range routinely pass 2^53. A float here is a wrong system, silently.
    const file = readRavenExport(REAL);
    expect(file?.systemId64).toBe('3382588805794');
    expect(typeof file?.systemId64).toBe('string');
  });

  it('reads the coordinates, which the map needs', () => {
    expect(readRavenExport(REAL)?.coords).toEqual({ x: 108.1875, y: 55.1875, z: -236.125 });
  });

  /* ------------------------------------------------------- files that are not perfect */

  it('★ MANDATORY: a broken section costs that section, not the import ★', () => {
    /*
     * A member picks a file off their disk. A newer Raven, a hand edit, a truncated download — none
     * of those should throw away forty good bodies. It reports what it could not read and keeps
     * going, so the preview can say so.
     */
    const file = readRavenExport({ ...REAL, sites: 'not-a-list' });

    expect(file, 'still an import').not.toBeNull();
    expect(file?.bodies.length, 'the bodies survived').toBe(3);
    expect(file?.slots.length, 'and the slots').toBe(5);
    expect(file?.problems.join(' ')).toMatch(/structure list/i);
  });

  it('skips bodies with no id or name, and says how many', () => {
    const file = readRavenExport({
      ...REAL,
      bodies: [...REAL.bodies, { name: 'nameless' }, { num: 99 }],
    });

    expect(file?.bodies.length).toBe(3);
    expect(file?.problems.join(' ')).toMatch(/2 bodies/);
  });

  it('★ MANDATORY: refuses only when there is nothing to import into ★', () => {
    /*
     * Two cases return null rather than a partial answer: not JSON at all, and no system name. The
     * name is the one fact everything hangs off, and guessing it from the body names would be
     * inventing it.
     */
    expect(readRavenExport('{ not json')).toBeNull();
    expect(readRavenExport({ ...REAL, name: '  ' })).toBeNull();
    expect(readRavenExport(42)).toBeNull();
  });

  it('accepts the raw text as readily as the parsed object', () => {
    // The caller reading a file and the caller holding an object should not need two functions.
    const file = readRavenExport(JSON.stringify(REAL));
    expect(file?.systemName).toBe('Col 285 Sector GL-W c2-12');
  });

  it('an absent section is not a problem, only an unreadable one is', () => {
    // A file with no slots block simply has no slot data; that is not something to warn about.
    const { slots: _slots, ...noSlots } = REAL;
    const file = readRavenExport(noSlots);

    expect(file?.slots).toEqual([]);
    expect(file?.problems).toEqual([]);
  });

  describe('what the member is told before anything is written', () => {
    it('★ MANDATORY: counts what will change, so the preview is not a leap of faith ★', () => {
      /*
       * The worst outcome available here is silently replacing a plan somebody spent an evening on.
       */
      const summary = describeRavenImport(readRavenExport(REAL)!);

      expect(summary).toContain('Col 285 Sector GL-W c2-12');
      expect(summary).toContain('3 bodies');
      expect(summary).toContain('3 structures');
      /*
       * THREE, not two. Two are complete and one is `building` — and the game has taken the slot
       * for all three, so the drafter must work around all three. What this line answers is "how
       * much of this system is already spoken for", not "how much is finished".
       */
      expect(summary, 'and which of them cannot be moved').toContain('3 already placed');
      expect(summary).toContain('slot counts for 5 bodies');
    });

    it('says nothing about sections the file does not have', () => {
      const summary = describeRavenImport(readRavenExport({ ...REAL, sites: [], slots: {} })!);

      expect(summary).toContain('3 bodies');
      expect(summary).not.toMatch(/structure/);
      expect(summary).not.toMatch(/slot/);
    });
  });
});
