import { describe, expect, it } from 'vitest';
import { slotWarnings, slotsUnrecorded } from './colony-slots.js';

/**
 * Telling a member a body may not fit what they have planned on it.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * Slot counts are not on Spansh — verified against the live dump, 43 body keys, none of them about
 * colonisation. They are read off the in-game architect view by a member who is there.
 *
 * That single fact decides everything below: the numbers are observations, so the planner WARNS and
 * never refuses. The non-landable rule can refuse because the galaxy dump is authoritative about
 * landability; nothing here is authoritative.
 */

const use = (over: Partial<Parameters<typeof slotWarnings>[0]> = {}) => ({
  orbitalSlots: null,
  surfaceSlots: null,
  orbitalPlanned: 0,
  surfacePlanned: 0,
  ...over,
});

describe('a body asked for more than it has', () => {
  it('★ MANDATORY: an UNRECORDED body is never warned about ★', () => {
    /*
     * Null means nobody has looked, not "no room". Treating it as zero would put a warning on every
     * body nobody has surveyed — 120 of the 184 we hold — and a list that always warns is one
     * nobody reads.
     */
    const w = slotWarnings(use({ orbitalPlanned: 5, surfacePlanned: 5 }));
    expect(w).toEqual([]);
  });

  it('★ MANDATORY: a recorded ZERO is a real answer and IS warned about ★', () => {
    /*
     * The other half of the same distinction. A member who looked and saw no orbital slots has told
     * us something; skipping that because it is falsy would silently lose the observation.
     */
    const w = slotWarnings(use({ orbitalSlots: 0, orbitalPlanned: 1 }));

    expect(w).toHaveLength(1);
    expect(w[0]?.where).toBe('orbital');
  });

  it('says nothing when the builds fit', () => {
    expect(slotWarnings(use({ orbitalSlots: 3, orbitalPlanned: 3 }))).toEqual([]);
    expect(slotWarnings(use({ surfaceSlots: 2, surfacePlanned: 1 }))).toEqual([]);
  });

  it('names the counts, because 3-of-2 and 30-of-2 are different problems', () => {
    const [w] = slotWarnings(use({ orbitalSlots: 2, orbitalPlanned: 3 }));

    expect(w?.message).toContain('3 orbital builds');
    expect(w?.message).toContain('2 orbital slots');
  });

  it('gets the singular right', () => {
    const [w] = slotWarnings(use({ surfaceSlots: 1, surfacePlanned: 2 }));

    expect(w?.message).toContain('2 surface builds');
    expect(w?.message).toContain('1 surface slot recorded');
    expect(w?.message, 'the plural s must not creep back in').not.toContain('1 surface slots');
  });

  it('★ MANDATORY: it warns, and never says the plan is refused ★', () => {
    /*
     * The owner chose warn-not-block, on the reasoning that a stale or mistyped count must not stop
     * somebody planning a build the game would allow. The wording has to match the behaviour: a
     * sentence that reads like a refusal would have members rebuilding plans that were fine.
     */
    const [w] = slotWarnings(use({ orbitalSlots: 1, orbitalPlanned: 4 }));

    expect(w?.message).toMatch(/may be out of date|may not fit/i);
    expect(w?.message).not.toMatch(/cannot|refus|not allowed|blocked/i);
  });

  it('warns about both halves independently', () => {
    const w = slotWarnings(
      use({ orbitalSlots: 1, orbitalPlanned: 2, surfaceSlots: 0, surfacePlanned: 1 }),
    );

    expect(w.map((x) => x.where)).toEqual(['orbital', 'surface']);
  });
});

describe('a body nobody has surveyed', () => {
  it('★ MANDATORY: says so, and says where the number comes from ★', () => {
    /*
     * The bug the owner reported was a BLANK. A blank reads as broken; it does not tell a member
     * that the number is theirs to supply, or that the game is the only place it exists.
     */
    const msg = slotsUnrecorded(null, null);

    expect(msg).not.toBeNull();
    expect(msg, 'names the architect view — the only place this number exists').toMatch(
      /architect/i,
    );
  });

  it('stays quiet once anything is recorded', () => {
    // A reassuring sentence beside a fact is noise.
    expect(slotsUnrecorded(3, null)).toBeNull();
    expect(slotsUnrecorded(null, 0)).toBeNull();
    expect(slotsUnrecorded(2, 1)).toBeNull();
  });
});
