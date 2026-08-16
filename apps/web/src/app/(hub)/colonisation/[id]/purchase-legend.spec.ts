import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commanderColour } from '@grims/shared/commander-colour';

/**
 * Who bought it, in their own colour.
 *
 * ★ SQUADRON OWNER ★
 *
 * "assign different and random colors for each player and list the carrier id and each player
 * commander name with a color legend under each item that they hold"
 *
 * ★ WHAT THE COLOUR IS ACTUALLY FOR ★
 *
 * Not decoration. The catalogue is a long list of commodity lines, and a name rendered in the same
 * grey as the tonnage beside it reads as part of the number. The colour is what lets somebody scan
 * it and see instantly which lines are theirs and which are not — which is the whole reason the
 * feature was asked for: two members buying the same commodity for the same build is a wasted trip
 * and a wasted hold.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/app/(hub)/colonisation/[id]/purchase-catalogue.tsx'),
  'utf8',
);

describe('the colour is stable and personal', () => {
  it('★ MANDATORY: the same commander is always the same colour ★', () => {
    /*
     * Derived from the id rather than stored, so it holds across every row of every project with
     * nothing having to remember it. A colour that changed between pages would be worse than none —
     * a member would learn to distrust it and go back to reading names.
     */
    expect(commanderColour('grim')).toBe(commanderColour('grim'));
  });

  it('★ MANDATORY: near-identical names do not collide ★', () => {
    // "grim" and "grim2" landing on one colour is the failure mode a naive hash has, and it is the
    // exact pair a squadron actually contains.
    expect(commanderColour('grim')).not.toBe(commanderColour('grim2'));
  });
});

describe('the catalogue renders it', () => {
  it('★ MANDATORY: the buyer is a coloured chip, not plain text ★', () => {
    /*
     * It used to be appended as ` · name` in the same colour as everything else. That is the version
     * that reads as part of the tonnage.
     */
    expect(SRC).toContain('commanderColour(line.by)');
    expect(SRC, 'the old plain-text form must be gone').not.toContain('` · ${line.by}`');
  });

  it('★ MANDATORY: imported by SUBPATH, because this is a client bundle ★', () => {
    // The barrel reaches node:crypto. This component ships to the browser.
    expect(SRC).toContain("from '@grims/shared/commander-colour'");
  });

  it('a line nobody is named on renders no chip at all', () => {
    // A watched purchase can have no commander attached. An empty chip would read as somebody whose
    // name failed to load, which is worse than the absence it is describing.
    expect(SRC).toContain('line.by === null ? null : (');
  });
});
