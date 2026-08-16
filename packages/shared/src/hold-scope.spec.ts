import { describe, expect, it } from 'vitest';
import { scopeHold, type ProjectWant } from './hold-scope.js';

/**
 * What of a member's hold the hub is allowed to remember.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked whether ship holds should be tracked server-side, the answer was: only while on a project,
 * and cleared when they undock empty or leave it.
 *
 * ★ WHY THAT BOUNDARY AND NOT THE EASY ONE ★
 *
 * Storing every hold on every upload would answer the question and a great many others nobody asked
 * — the hub would hold a live record of what every member is carrying, everywhere, for ever. The
 * question that actually needs answering is narrow: "is somebody already carrying the Titanium this
 * build wants". Everything beyond that is collection for its own sake.
 *
 * So the filter is the PROJECT'S want list. A commodity no live build needs is not stored, and the
 * same member's mining run, trade loop and mission cargo never reach the hub at all.
 *
 * ★ AND IT MUST FORGET ★
 *
 * A hold that is only ever added to is a hold that is wrong the moment somebody sells. Undocking
 * empty, or the project closing, has to clear it — or the board keeps promising materials that were
 * spent days ago, which is the same wasted trip this module keeps producing under other names.
 */

const want = (commodity: string, remaining = 1_000): ProjectWant => ({ commodity, remaining });

describe('what is kept', () => {
  it('★ MANDATORY: only commodities a live build still wants ★', () => {
    const out = scopeHold(
      [
        { commodity: 'Titanium', tonnes: 480 },
        { commodity: 'Painite', tonnes: 200 },
      ],
      [want('Titanium')],
    );

    expect(out).toEqual([{ commodity: 'Titanium', tonnes: 480 }]);
  });

  it('★ MANDATORY: a member carrying nothing the build needs stores NOTHING ★', () => {
    /*
     * The ordinary case for most uploads, and the one that decides whether this is a narrow feature
     * or a general cargo tracker. A mining run must leave no trace here.
     */
    expect(scopeHold([{ commodity: 'Painite', tonnes: 700 }], [want('Titanium')])).toEqual([]);
  });

  it('matches the way the rest of the module matches commodity names', () => {
    // "H.E. Suits" and "Hazardous Environment Suits" are one commodity. Missing that here would
    // silently drop a hold the build genuinely wants — the same alias bug this codebase has had.
    const out = scopeHold([{ commodity: 'H.E. Suits', tonnes: 12 }], [want('Hazardous Environment Suits')]);

    expect(out).toEqual([{ commodity: 'H.E. Suits', tonnes: 12 }]);
  });

  it('★ MANDATORY: a want that is already satisfied keeps nothing ★', () => {
    /*
     * `remaining` at zero means the build wants no more of it. Continuing to store it would show a
     * member holding materials for a line that is finished, which reads as work still to do.
     */
    expect(scopeHold([{ commodity: 'Titanium', tonnes: 480 }], [want('Titanium', 0)])).toEqual([]);
  });
});

describe('what it forgets', () => {
  it('★ MANDATORY: an empty hold clears everything ★', () => {
    /*
     * Undocking empty is the signal that the cargo is gone. A store that only ever adds is one that
     * promises materials somebody spent days ago — the wasted trip this module keeps reinventing.
     */
    expect(scopeHold([], [want('Titanium')])).toEqual([]);
  });

  it('★ MANDATORY: no live wants means nothing is kept, whatever is aboard ★', () => {
    // The member left the project, or it closed. The reason to hold any of this went with it.
    expect(scopeHold([{ commodity: 'Titanium', tonnes: 480 }], [])).toEqual([]);
  });

  it('a smaller hold replaces the larger one rather than merging', () => {
    /*
     * Asserted because the tempting implementation is a running total. Selling 300 of 480 must show
     * 180 — a maximum-so-far would show 480 for ever and there would be no event that corrects it.
     */
    const out = scopeHold([{ commodity: 'Titanium', tonnes: 180 }], [want('Titanium')]);

    expect(out).toEqual([{ commodity: 'Titanium', tonnes: 180 }]);
  });
});

describe('the arithmetic', () => {
  it('several stacks of one commodity are added up', () => {
    // Cargo.json reports per stack. Three Titanium rows is a number the member should not have to
    // add up themselves.
    const out = scopeHold(
      [
        { commodity: 'Titanium', tonnes: 300 },
        { commodity: 'Titanium', tonnes: 180 },
      ],
      [want('Titanium')],
    );

    expect(out).toEqual([{ commodity: 'Titanium', tonnes: 480 }]);
  });

  it('a zero or negative line is dropped rather than stored', () => {
    // A zero row is a stack that has just been emptied. Storing it would draw a member holding
    // nothing, which is noise on a panel read at a glance.
    const out = scopeHold(
      [
        { commodity: 'Titanium', tonnes: 0 },
        { commodity: 'Steel', tonnes: -5 },
      ],
      [want('Titanium'), want('Steel')],
    );

    expect(out).toEqual([]);
  });
});
