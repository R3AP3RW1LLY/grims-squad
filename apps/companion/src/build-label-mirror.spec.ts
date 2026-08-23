import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The build_type_id must be on screen wherever a member picks or reads a build — on BOTH surfaces.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "the build_type_id should be provided in that list so we know what we're choosing ... and remember
 * we need all of this in full parity on the website and the companion app"
 *
 * A member plans here and builds in the game. "Refinery Hub" says what a structure does; `silenus`
 * is what the architect view calls it. Without the id the planner sends them off to look it up,
 * which is the work the planner exists to remove. The build books have printed ids on every row
 * since they were written; the planner never did.
 *
 * ★ WHY A SOURCE-TEXT MIRROR ★
 *
 * Same reasoning as the colonisation menu, the orphan flags and the scout notice before it. These
 * are a React component and a Preact component in different packages and runtimes; nothing links
 * them, and this is the FOURTH thing to drift between these two screens.
 *
 * The wording is not duplicated — both call `buildTypeLabel` in @grims/shared, so the format cannot
 * disagree. What this guards is that each surface still asks.
 */

const REPO = join(process.cwd(), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const SURFACES = [
  ['website picker/tree', 'apps/web/src/app/(hub)/colonisation/planning/[id]/system-tree.tsx'],
  ['website build order', 'apps/web/src/app/(hub)/colonisation/planning/[id]/build-order.tsx'],
  ['website economy table', 'apps/web/src/app/(hub)/colonisation/planning/[id]/economy-markets.tsx'],
  ['companion planning', 'apps/companion/src/renderer/planning.tsx'],
] as const;

describe('the build_type_id is shown on both surfaces', () => {
  it('★ MANDATORY: every surface uses the shared label ★', () => {
    for (const [what, rel] of SURFACES) {
      const src = read(rel);

      // A guard on the guard: a moved file would read empty and pass everything below.
      expect(src.length, `${what} is readable`).toBeGreaterThan(500);
      expect(src, `${what} must show the build_type_id`).toContain('colony-build-label');
    }
  });

  it('★ MANDATORY: nothing renders a build type without its id ★', () => {
    /*
     * The exact pattern that was there before — a display name with no id beside it. If it comes
     * back, a member is reading "Refinery Hub" with nothing they can type into the game.
     *
     * Matched on the RENDER, not the string: `buildTypeName` still appears legitimately in types
     * and in the label calls themselves.
     */
    for (const [what, rel] of SURFACES) {
      const src = read(rel);

      expect(
        src,
        `${what} renders a bare build type name with no id`,
      ).not.toMatch(/\{\s*s\.buildTypeName\s*\?\?\s*'nothing chosen/);
      expect(
        src,
        `${what} renders a bare display name in a picker`,
      ).not.toMatch(/\{\s*b\.displayName\s*\}/);
    }
  });

  it('the id is rendered verbatim, not prettified', () => {
    /*
     * It is typed into the game exactly as stored. If a surface ever upper-cases it, the planner
     * and the build books disagree by one keystroke and a member has to know which to trust.
     */
    const shared = read('packages/shared/src/colony-build-label.ts');

    expect(shared).toContain('export function buildTypeLabel');
    expect(shared, 'no case transformation anywhere in the formatter').not.toMatch(
      /toUpperCase|toLocaleUpperCase|charAt\(0\)\.toUpperCase/,
    );
  });
});
