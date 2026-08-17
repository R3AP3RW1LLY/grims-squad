import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A finished commodity, struck through on every surface.
 *
 * ★ SQUADRON OWNER ★
 *
 * ★ WHY THE ROW IS KEPT AT ALL ★
 *
 * `needs-table.tsx` records what happened when it was not: a `remaining > 0` filter deleted a line
 * the moment its commodity finished, which hid 584,108 tonnes of completed work and made a build
 * that was nearly done look barely started. So finished rows stay.
 *
 * But a kept row that looks like every other row is a line members keep hauling to — and on the
 * overlay, which is read mid-flight in the seconds before opening a commodity market, it is the one
 * somebody buys again.
 *
 * Struck through and green says "finished" at a glance without removing the evidence that it was
 * ever needed.
 *
 * ★ ASSERTED ON ALL THREE, BECAUSE THEY ARE ONE BOARD ★
 *
 * The website, the desktop screens and the in-game overlay each render the same needs list. This
 * module's recurring defect is a rule landing on one surface and not the others — the needs
 * freshness warning, the cAPI source, the carrier merge — so the parity is the test.
 */

const read = (f: string): string => readFileSync(join(process.cwd(), f), 'utf8');

const SURFACES: readonly [string, string][] = [
  ['the website', 'src/app/(hub)/colonisation/[id]/needs-table.tsx'],
  ['the companion', '../companion/src/renderer/colonisation.tsx'],
  ['the in-game overlay', '../companion/src/renderer/overlay.tsx'],
];

describe('a finished commodity reads as finished', () => {
  it('★ MANDATORY: every surface strikes it through ★', () => {
    for (const [name, file] of SURFACES) {
      const src = read(file);
      expect(src, `${name} must strike through a finished row`).toMatch(
        /line-through|textDecoration: 'line-through'/,
      );
    }
  });

  it('★ MANDATORY: and none of them DELETES the row ★', () => {
    /*
     * The regression that struck-through rows exist to make safe. Filtering on `remaining > 0` is
     * what hid the completed work in the first place; striking a row through is only an improvement
     * if the row is still there.
     */
    const web = read('src/app/(hub)/colonisation/[id]/needs-table.tsx');
    expect(web, 'finished rows are sorted to the end, not filtered out').toContain(
      'needs.filter((n) => n.remaining <= 0)',
    );

    const app = read('../companion/src/renderer/colonisation.tsx');
    expect(app, 'the app appends the finished rows rather than dropping them').toContain(
      '[...outstanding, ...done]',
    );
  });
});
