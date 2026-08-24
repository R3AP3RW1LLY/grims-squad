import { describe, expect, it } from 'vitest';
import { describeRavenPreview, previewRavenImport, type CurrentBody, type CurrentSite } from './raven-preview.js';
import type { RavenImport } from './raven-import.js';

/**
 * What importing a Raven export would change, before anything is written.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "Import wins, and say so."
 *
 * The winning is easy. The saying so is the whole of this file: the worst outcome available to this
 * feature is silently replacing a plan somebody spent an evening on, and every failure mode is
 * quiet — the plan just becomes something else and nothing says which parts were theirs.
 */

const file = (over: Partial<RavenImport> = {}): RavenImport => ({
  systemName: 'Col 285 Sector GL-W c2-12',
  systemId64: '3382588805794',
  coords: null,
  architect: 'PEBBLEMERCAHNT',
  bodies: [],
  sites: [],
  slots: [],
  version: 6,
  problems: [],
  ...over,
});

const body = (over: Partial<CurrentBody> = {}): CurrentBody => ({
  bodyId: 18,
  name: 'A 1 f',
  orbitalSlots: null,
  surfaceSlots: null,
  slotsAt: null,
  ...over,
});

const site = (over: Partial<CurrentSite> = {}): CurrentSite => ({
  bodyId: 18,
  buildTypeId: 'ourea',
  state: 'planned',
  ...over,
});

describe('previewing a Raven import', () => {
  it('★ MANDATORY: overwriting a HAND-TYPED count is called out separately ★', () => {
    /*
     * The one line that matters. `slotsAt` is the record of a person having typed these, and its
     * presence turns "filling in a blank" into "overruling somebody". Those must not read alike.
     */
    const preview = previewRavenImport(
      file({ slots: [{ bodyNum: 18, orbital: 3, surface: 2 }] }),
      { bodies: [body({ orbitalSlots: 1, surfaceSlots: 1, slotsAt: '2026-08-07T05:34:07Z' })], sites: [] },
    );

    expect(preview.slotsChanged).toHaveLength(1);
    expect(preview.slotsChanged[0]?.overwritesTyped).toBe(true);
    expect(preview.slotsChanged[0]?.from).toEqual({ orbital: 1, surface: 1 });
    expect(preview.slotsChanged[0]?.to).toEqual({ orbital: 3, surface: 2 });

    expect(describeRavenPreview(preview)[0], 'and it leads').toMatch(/entered by hand will be replaced/i);
  });

  it('★ MANDATORY: losses come before gains ★', () => {
    /*
     * The same ordering the survey warnings and the plan checker already use. A summary that leads
     * with "nine counts added" and buries "two you typed will be replaced" is designed to be agreed
     * with rather than read.
     */
    const preview = previewRavenImport(
      file({
        slots: [
          { bodyNum: 18, orbital: 3, surface: 2 },
          { bodyNum: 22, orbital: 1, surface: 2 },
        ],
        sites: [{ id: 'x', name: 'n', bodyNum: 22, buildTypeId: 'minerva', status: 'planned' }],
      }),
      {
        bodies: [
          body({ bodyId: 18, orbitalSlots: 1, surfaceSlots: 1, slotsAt: '2026-08-07T05:34:07Z' }),
          body({ bodyId: 22, name: 'A 2 a' }),
        ],
        sites: [],
      },
    );

    const lines = describeRavenPreview(preview);
    const replaced = lines.findIndex((l) => /replaced/i.test(l));
    const added = lines.findIndex((l) => /first time/i.test(l));

    expect(replaced, 'the loss is reported').toBeGreaterThan(-1);
    expect(added, 'and so is the gain').toBeGreaterThan(-1);
    expect(replaced, 'but the loss is read first').toBeLessThan(added);
  });

  it('★ MANDATORY: replacing a previous IMPORT is not overruling anybody ★', () => {
    /*
     * ★ WITHOUT THIS, THE SECOND IMPORT LIES ★
     *
     * `slotsAt` says the counts were set; it cannot say by what. An earlier import stamps a member
     * id and a date exactly as typing does — so re-importing an updated file would announce "you
     * entered these by hand and they will be replaced", naming work the member never did, about
     * figures that came from the very file they are importing again.
     *
     * A warning that cries wolf on a routine action is worse than none: it is what teaches people to
     * click through the real one.
     */
    const preview = previewRavenImport(
      file({ slots: [{ bodyNum: 18, orbital: 4, surface: 2 }] }),
      {
        bodies: [
          body({ orbitalSlots: 3, surfaceSlots: 2, slotsAt: '2026-08-24T20:00:00Z', slotsSource: 'import' }),
        ],
        sites: [],
      },
    );

    expect(preview.slotsChanged, 'it is still a change').toHaveLength(1);
    expect(preview.slotsChanged[0]?.overwritesTyped, 'but nobody is overruled').toBe(false);
    expect(describeRavenPreview(preview).join(' ')).not.toMatch(/entered by hand/i);
  });

  it('a row predating the source column is treated as typed, and warned about', () => {
    /*
     * Honest: before the column existed, typing was the only way those numbers could have got
     * there. Warning is right, and it is the cautious direction regardless.
     */
    const preview = previewRavenImport(
      file({ slots: [{ bodyNum: 18, orbital: 4, surface: 2 }] }),
      { bodies: [body({ orbitalSlots: 3, surfaceSlots: 2, slotsAt: '2026-08-07T05:34:07Z' })], sites: [] },
    );

    expect(preview.slotsChanged[0]?.overwritesTyped).toBe(true);
  });

  it('filling an empty body is an addition, not a replacement', () => {
    const preview = previewRavenImport(
      file({ slots: [{ bodyNum: 18, orbital: 3, surface: 2 }] }),
      { bodies: [body()], sites: [] },
    );

    expect(preview.slotsAdded).toHaveLength(1);
    expect(preview.slotsChanged).toHaveLength(0);
    expect(preview.slotsAdded[0]?.overwritesTyped).toBe(false);
  });

  it('★ MANDATORY: a slot record for an unknown body warns about the FILE ★', () => {
    /*
     * Almost always means the member picked an export for a different system — the mistake they most
     * want catching before they press the button, and one a count alone would not convey.
     */
    const preview = previewRavenImport(
      file({ slots: [{ bodyNum: 999, orbital: 1, surface: 1 }] }),
      { bodies: [body()], sites: [] },
    );

    expect(preview.unknownBodies).toEqual(['body 999']);
    expect(describeRavenPreview(preview)[0]).toMatch(/check this is the right file/i);
  });

  it('says nothing about counts that already agree', () => {
    // Re-importing the same file must be a no-op, not a page of changes.
    const preview = previewRavenImport(
      file({ slots: [{ bodyNum: 18, orbital: 3, surface: 2 }] }),
      { bodies: [body({ orbitalSlots: 3, surfaceSlots: 2, slotsAt: '2026-08-07T05:34:07Z' })], sites: [] },
    );

    expect(preview.identical).toBe(true);
    expect(describeRavenPreview(preview)).toEqual([
      'This file matches the plan already — nothing would change.',
    ]);
  });

  describe('structures', () => {
    it('counts one the plan does not have', () => {
      const preview = previewRavenImport(
        file({ sites: [{ id: 'x', name: 'n', bodyNum: 18, buildTypeId: 'ourea', status: 'planned' }] }),
        { bodies: [body()], sites: [] },
      );

      expect(preview.sitesAdded).toBe(1);
    });

    it('ignores one the plan already holds', () => {
      // Same structure, same body, is the same structure. Re-import must not duplicate it.
      const preview = previewRavenImport(
        file({ sites: [{ id: 'x', name: 'n', bodyNum: 18, buildTypeId: 'ourea', status: 'complete' }] }),
        { bodies: [body()], sites: [site()] },
      );

      expect(preview.sitesAdded).toBe(0);
      expect(preview.identical).toBe(true);
    });

    it('★ MANDATORY: a BUILT structure disagreeing with the plan is reported, not applied ★', () => {
      /*
       * The game is the authority on what is standing — but silently replacing somebody's intention
       * with it is the same quiet edit this whole preview exists to prevent. It is named, in words,
       * with both sides shown, and the member decides.
       */
      const preview = previewRavenImport(
        file({ sites: [{ id: 'x', name: 'n', bodyNum: 18, buildTypeId: 'minerva', status: 'complete' }] }),
        { bodies: [body()], sites: [site({ buildTypeId: 'ourea' })] },
      );

      expect(preview.sitesAdded, 'not silently added').toBe(0);
      expect(preview.siteConflicts).toHaveLength(1);
      expect(preview.siteConflicts[0]).toContain('A 1 f');
      expect(preview.siteConflicts[0]).toContain('minerva');
      expect(preview.siteConflicts[0], 'and what the plan thinks').toContain('ourea');
    });

    it('a merely PLANNED structure alongside another is just an addition', () => {
      /*
       * Two intentions on one body is ordinary — bodies hold several slots. Only a claim that
       * something is BUILT contradicts what the plan says is there.
       */
      const preview = previewRavenImport(
        file({ sites: [{ id: 'x', name: 'n', bodyNum: 18, buildTypeId: 'minerva', status: 'planned' }] }),
        { bodies: [body()], sites: [site({ buildTypeId: 'ourea' })] },
      );

      expect(preview.siteConflicts).toEqual([]);
      expect(preview.sitesAdded).toBe(1);
    });
  });

  it('carries the parser’s own problems through, so one screen shows everything', () => {
    const preview = previewRavenImport(
      file({ problems: ['The structure list could not be read.'] }),
      { bodies: [], sites: [] },
    );

    expect(describeRavenPreview(preview)).toContain('The structure list could not be read.');
  });

  it('★ MANDATORY: writes nothing ★', () => {
    /*
     * A preview that mutated anything would defeat its own purpose. Guarded by giving it frozen
     * input: any write attempt throws, and the test fails rather than passing quietly.
     */
    const bodies = Object.freeze([Object.freeze(body({ orbitalSlots: 1, surfaceSlots: 1 }))]);
    const sites = Object.freeze([Object.freeze(site())]);

    expect(() =>
      previewRavenImport(file({ slots: [{ bodyNum: 18, orbital: 3, surface: 2 }] }), { bodies, sites }),
    ).not.toThrow();

    expect(bodies[0]?.orbitalSlots, 'the caller’s data is untouched').toBe(1);
  });
});
