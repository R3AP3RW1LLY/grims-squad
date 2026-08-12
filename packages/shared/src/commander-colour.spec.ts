import { describe, expect, it } from 'vitest';
import { commanderColour, COMMANDER_PALETTE } from './commander-colour.js';

/**
 * A colour that means "this commander", everywhere, for everybody.
 *
 * ★ SQUADRON OWNER, 2026-08-12 ★
 *
 * "assign different and random colors for each player and list the carrier id and each player
 * commander name with a color legend under each item that they hold"
 *
 * ★ STABLE, NOT RANDOM — the owner's choice when asked ★
 *
 * Random was the literal request and would have worked once. The legend is read while deciding what
 * to buy, on a page a member returns to all evening and compares against what somebody else is
 * seeing — so a colour that changes between sessions, or between two people looking at the same
 * build, makes the legend something you must re-read every time instead of something you learn.
 *
 * Derived from the commander's id, so it is the same everywhere with nothing stored and no
 * coordination between the website and the app.
 */

describe('a commander’s colour', () => {
  it('★ MANDATORY: the same commander always gets the same colour ★', () => {
    // The entire point. Two calls, two pages, two sessions, two viewers.
    expect(commanderColour('u-grim')).toBe(commanderColour('u-grim'));
  });

  it('★ MANDATORY: it comes from the palette, never an arbitrary value ★', () => {
    /*
     * The palette is spaced for legibility on the dark theme and deliberately clear of the green and
     * amber the build states already use — a "held by" dot that reads as "complete" would be worse
     * than no colour at all.
     */
    for (const id of ['u-1', 'u-2', 'commander-with-a-much-longer-id', '', '404']) {
      expect(COMMANDER_PALETTE).toContain(commanderColour(id));
    }
  });

  it('★ MANDATORY: commanders on one build get different colours ★', () => {
    /*
     * The case that matters: a legend under one commodity, several people holding it. Identical
     * colours there would defeat the feature at exactly the moment it is being used.
     *
     * Not a promise of global uniqueness — with a palette of N, the (N+1)th commander must repeat —
     * but the ids that actually appear together must be told apart.
     */
    const together = ['u-grim', 'u-sarah', 'u-talen', 'u-mike', 'u-vixie'];
    const colours = new Set(together.map(commanderColour));

    expect(colours.size, 'five commanders on one commodity must be five colours').toBe(
      together.length,
    );
  });

  it('MANDATORY: an empty or unknown id still returns a real colour', () => {
    // A missing id must not render an undefined colour into a style attribute.
    expect(COMMANDER_PALETTE).toContain(commanderColour(''));
  });

  it('MANDATORY: the palette avoids the colours the build states own', () => {
    /*
     * `complete` is green and `started` is amber on both surfaces. A commander whose dot is either
     * would be read as a state rather than as a person.
     */
    const forbidden = ['#7ce38b', '#ff9d3f'];
    for (const c of COMMANDER_PALETTE) {
      expect(forbidden, `${c} collides with a build-state colour`).not.toContain(c.toLowerCase());
    }
  });

  it('the palette is big enough to be worth having', () => {
    expect(COMMANDER_PALETTE.length).toBeGreaterThanOrEqual(8);
  });
});
