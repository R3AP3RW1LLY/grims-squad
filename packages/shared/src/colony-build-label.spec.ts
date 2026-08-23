import { describe, expect, it } from 'vitest';
import { buildTypeLabel, siteBuildLabel } from './colony-build-label.js';

/**
 * The id a member has to type into the game must be on screen.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "the build_type_id should be provided in that list so we know what we're choosing"
 *
 * A member plans here and builds there. "Refinery Hub" tells them what a structure does; `silenus`
 * is what the game's architect view calls it, and without it the planner sends them off to look it
 * up — the exact work the planner exists to remove.
 */

describe('writing a build type where a member can act on it', () => {
  it('★ MANDATORY: the id is always shown ★', () => {
    expect(buildTypeLabel('Refinery Hub', 'silenus')).toBe('Refinery Hub (silenus)');
  });

  it('★ MANDATORY: the id is verbatim, never prettified ★', () => {
    /*
     * It is typed into the game exactly as stored. Title-casing it to read more like a name would
     * put the planner and the build books one keystroke apart — and a member would then have to
     * know which of the two to trust, which is worse than showing neither.
     */
    const label = buildTypeLabel('Refinery Hub', 'silenus');

    expect(label).toContain('silenus');
    expect(label, 'no capitalising, no underscores swapped for spaces').not.toContain('Silenus');
  });

  it('an id with no description still identifies the build', () => {
    // A catalogue row that never got a description is still buildable; the id is the working half.
    expect(buildTypeLabel(null, 'hermes')).toBe('hermes');
    expect(buildTypeLabel('   ', 'hermes')).toBe('hermes');
  });

  it('a description with no id is shown alone, not with empty brackets', () => {
    expect(buildTypeLabel('Refinery Hub', null)).toBe('Refinery Hub');
    expect(buildTypeLabel('Refinery Hub', '  ')).toBe('Refinery Hub');
  });

  it('nothing at all is an empty string, for the caller to handle', () => {
    expect(buildTypeLabel(null, null)).toBe('');
    expect(buildTypeLabel(undefined, undefined)).toBe('');
  });

  describe('a site that has not chosen a build yet', () => {
    it('★ MANDATORY: says so, rather than rendering a blank ★', () => {
      /*
       * An unchosen site is the ordinary state of a plan somebody is still filling in. A blank cell
       * where a member expects their own decision reflected back reads as data loss.
       */
      expect(siteBuildLabel(null, null)).toBe('nothing chosen yet');
    });

    it('shows the id once a build IS chosen', () => {
      expect(siteBuildLabel('Refinery Hub', 'silenus')).toBe('Refinery Hub (silenus)');
    });

    it('lets a caller word the empty case for its own context', () => {
      expect(siteBuildLabel(null, null, 'nothing chosen')).toBe('nothing chosen');
    });
  });
});
