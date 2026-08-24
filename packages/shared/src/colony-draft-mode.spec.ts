import { describe, expect, it } from 'vitest';
import {
  draftContext,
  fixedBrief,
  sitesForDraft,
  type ExistingSite,
} from './colony-draft-mode.js';

/**
 * Drafting a system somebody has already started building.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "if a system already has a partial build ask the user if they want to override it, or if they want
 * to keep it and we work around it etc."
 */

const site = (over: Partial<ExistingSite> = {}): ExistingSite => ({
  id: 's1',
  buildTypeId: 'silenus',
  bodyId: 3,
  bodyName: 'A 1 f',
  position: 0,
  isPrimary: false,
  state: 'planned',
  ...over,
});

describe('deciding what a draft may move', () => {
  it('★ MANDATORY: a posted project is FIXED, in both modes, always ★', () => {
    /*
     * ★ "OVERRIDE" CANNOT MEAN "UNBUILD" ★
     *
     * The game will not move a station that is standing or un-place one that is half-hauled.
     * Offering that as a choice would be offering something we cannot deliver, and the member would
     * find out only after flying somewhere.
     */
    const context = draftContext([
      site({ id: 'built', state: 'complete' }),
      site({ id: 'intended', state: 'planned', position: 1 }),
    ]);

    expect(context.fixed.map((s) => s.id)).toEqual(['built']);
    expect(sitesForDraft(context, 'override').map((s) => s.id)).toEqual(['built']);
    expect(sitesForDraft(context, 'keep').map((s) => s.id)).toEqual(['built', 'intended']);
  });

  it('★ MANDATORY: fixed the moment it is POSTED, not when it is finished ★', () => {
    /*
     * Posting a project means a commander was docked at a construction site the game had already
     * placed. The slot is spent whether or not a single tonne has been delivered — so 'started'
     * counts, and treating it as movable would draft a layout onto ground that is taken.
     */
    for (const state of ['started', 'building', 'complete'] as const) {
      const context = draftContext([site({ state })]);
      expect(context.fixed, `${state} is immovable`).toHaveLength(1);
      expect(context.intended).toHaveLength(0);
    }

    expect(draftContext([site({ state: 'planned' })]).intended, 'only planned can move').toHaveLength(
      1,
    );
  });

  it('★ MANDATORY: does not ask when there is nothing to decide ★', () => {
    /*
     * A plan that is entirely built has one possible outcome, and dressing it up as a choice teaches
     * people to click through questions — which is how the one that mattered gets clicked through.
     */
    expect(draftContext([site({ state: 'complete' })]).mustAsk).toBe(false);
    expect(draftContext([]).mustAsk, 'nor on an empty system').toBe(false);
    expect(draftContext([]).question).toBeNull();
  });

  it('asks as soon as there is a single intention to discard', () => {
    const context = draftContext([site({ state: 'planned' })]);

    expect(context.mustAsk).toBe(true);
    expect(context.question).toMatch(/replace|keep/i);
  });

  it('★ MANDATORY: says what is immovable even when it does NOT ask ★', () => {
    /*
     * A member who asked to redraft a fully-built system and got their existing stations back needs
     * to know that was the system being honest, rather than the drafter having failed.
     */
    const context = draftContext([site({ state: 'complete' })]);

    expect(context.mustAsk).toBe(false);
    expect(context.fixedNote).toMatch(/cannot be moved/i);
    expect(context.fixedNote).toMatch(/tier points/i);
  });

  it('says nothing about immovable ground when there is none', () => {
    expect(draftContext([site({ state: 'planned' })]).fixedNote).toBeNull();
    expect(draftContext([]).fixedNote).toBeNull();
  });

  it('★ MANDATORY: keeps BUILD ORDER, so the tier arithmetic continues from the real position ★', () => {
    /*
     * Tier points are earned and spent in sequence. A draft that restarts the count at zero is the
     * difference between a layout that can be built and one that runs out of points at step four.
     */
    const context = draftContext([
      site({ id: 'third', position: 2, state: 'complete' }),
      site({ id: 'first', position: 0, state: 'complete' }),
      site({ id: 'second', position: 1, state: 'planned' }),
    ]);

    expect(sitesForDraft(context, 'keep').map((s) => s.id)).toEqual(['first', 'second', 'third']);
    expect(context.fixed.map((s) => s.id), 'and the fixed list is ordered too').toEqual([
      'first',
      'third',
    ]);
  });

  it('words the question differently when the system is partly built', () => {
    /*
     * The two situations need different sentences: with nothing built, the whole plan is on the
     * table. With something built, only part of it is, and a question implying otherwise would be
     * describing a choice the member does not have.
     */
    const fresh = draftContext([site({ state: 'planned' })]).question ?? '';
    const partial = draftContext([
      site({ id: 'b', state: 'complete' }),
      site({ id: 'p', state: 'planned', position: 1 }),
    ]).question ?? '';

    expect(fresh).toMatch(/already has a plan/i);
    expect(partial).toMatch(/partly built/i);
  });

  it('gets the singular and plural right in both sentences', () => {
    const one = draftContext([site({ state: 'complete' })]);
    expect(one.fixedNote).toMatch(/1 structure is already placed/);
    expect(one.fixedNote).toMatch(/It stays where it is/);

    const two = draftContext([
      site({ id: 'a', state: 'complete' }),
      site({ id: 'b', state: 'complete', position: 1 }),
    ]);
    expect(two.fixedNote).toMatch(/2 structures are already placed/);
    expect(two.fixedNote).toMatch(/They stay where they are/);
  });

  describe('the brief the assistant is given', () => {
    it('★ MANDATORY: names the occupied ground, or the model builds on top of it ★', () => {
      /*
       * A model handed a list of bodies with no note of what stands on them will happily propose a
       * second station on a taken slot. The brief has to say what is there and that it cannot move.
       */
      const brief = fixedBrief([site({ buildTypeId: 'silenus', bodyName: 'A 1 f' })]);

      expect(brief).toMatch(/immovable/i);
      expect(brief).toContain('silenus');
      expect(brief).toContain('A 1 f');
      expect(brief, 'and that their points are already earned').toMatch(/already earned/i);
    });

    it('marks the primary, which the game charges nothing for', () => {
      expect(fixedBrief([site({ isPrimary: true })])).toMatch(/PRIMARY/);
      expect(fixedBrief([site({ isPrimary: false })])).not.toMatch(/PRIMARY/);
    });

    it('is empty when nothing is fixed, rather than a heading with no rows', () => {
      // A heading promising a list and then listing nothing reads as a bug to a model too.
      expect(fixedBrief([])).toBe('');
    });

    it('says so plainly when a fixed site has no body or no chosen structure', () => {
      const brief = fixedBrief([site({ bodyId: null, bodyName: null, buildTypeId: null })]);

      expect(brief).toMatch(/unchosen structure/);
      expect(brief).toMatch(/somewhere unrecorded/);
    });
  });
});
