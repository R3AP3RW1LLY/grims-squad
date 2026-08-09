import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The carrier's combined run.
 *
 * ★ WHY A SOURCE TEST AND NOT A RENDER TEST ★
 *
 * The same reasoning as the Commander Management page next door: this is an async server component
 * that fetches before it renders anything, and standing that up in jsdom would test the mocks. The
 * arithmetic that could actually be wrong lives in the API and is covered against real Postgres by
 * `colony-carrier-manifest.int.spec.ts` — including the one assertion that matters, that a shared
 * hold is subtracted once rather than once per build.
 *
 * What can regress HERE is wiring, and it is wiring that fails silently. Each of the three below has
 * a failure mode that looks like a working page.
 */

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

/** Comments stripped first — this page explains the double-counting at length, in prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the carrier run page', () => {
  const page = code(read('./page.tsx'));

  it('★ MANDATORY: the shopping list is told where to submit ★', () => {
    /*
     * `ShoppingList` derives its form action from `projectId` when none is given, which for this
     * page would post the filters to `/colonisation/` — a URL that is not this page and does not
     * exist. The list would still RENDER correctly; only changing the radius or the origin would
     * fail, and it would fail by navigating away rather than by erroring.
     *
     * That is exactly the kind of defect that ships: the page looks right in a screenshot.
     */
    expect(page, 'the ShoppingList has no action, so its filter form posts to the wrong URL').toMatch(
      /action=\{`\/colonisation\/carriers\/\$\{encodeURIComponent\(marketId\)\}`\}/,
    );
  });

  it('MANDATORY: it does not pass carrier cover to the sourcing', () => {
    /*
     * The manifest has ALREADY subtracted what is aboard — `toBuy` is what the sourcing receives.
     * Passing `carrierCover` as well would subtract the same cargo a second time and quote a run
     * short of what it actually needs, which is a wrong answer that looks like a good deal.
     */
    expect(page).not.toMatch(/carrierCover/);
  });

  it('shows what is aboard capped at what is wanted', () => {
    /*
     * A carrier holding 5,000 t of Steel against a 100 t need covers it; it does not mean 5,000 t
     * of progress. Uncapped, the "Aboard" tile would claim more is staged than the builds can take.
     */
    expect(page).toMatch(/Math\.min\(l\.needed, l\.aboard\)/);
  });

  it('links every build back to its own page', () => {
    // The aggregate is a starting point, not a replacement: somebody who sees an odd number needs
    // to be one click from the build that contributed it.
    expect(page).toMatch(/href=\{`\/colonisation\/\$\{p\.id\}`\}/);
  });
});

describe('the carriers tab offers the combined run', () => {
  const carriers = code(read('../../[id]/carriers.tsx'));

  it('MANDATORY: links to it, because nobody would guess the URL', () => {
    /*
     * The page is reachable only from here. Without the link it would be a feature that exists and
     * that no member ever sees — which has happened in this codebase three times, each time because
     * the code was right and nothing connected it.
     */
    expect(carriers).toMatch(/\/colonisation\/carriers\/\$\{encodeURIComponent\(c\.marketId\)\}/);
  });
});
