import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every sidebar destination actually renders something.
 *
 * ★ THE FAILURE THIS EXISTS FOR, FOUND FIVE TIMES IN ONE DAY ★
 *
 * The cheapest-versus-closest sort, the Frontier reconnect button, the buy-order toggle, the
 * station-ownership table, and — for about ten minutes — a Station ownership nav entry in this app
 * pointing at a page that did not exist. Every one of them was complete except where somebody could
 * reach it, and every one was confirmed present by reading the source.
 *
 * A nav entry with no branch in the dispatch is the purest form of it: the menu says the page is
 * there, the member clicks, and the content area renders nothing at all. No error, no blank-state
 * copy, no clue — just an app that appears to have stopped working.
 *
 * `colonisation-mirror.spec.ts` guards the colonisation menu against the WEBSITE. This guards every
 * menu against the app itself.
 */

const APP = readFileSync(join(process.cwd(), 'src', 'renderer', 'app.tsx'), 'utf8');

/** Every `id:` in the NAV array — top-level entries and grouped children alike. */
function navIds(): string[] {
  const start = APP.indexOf('const NAV');
  expect(start, 'the app still has a NAV array').toBeGreaterThan(-1);

  // The array ends at the closing `];` at column 0 — anything after is a different declaration.
  const end = APP.indexOf('\n];', start);
  expect(end, 'the NAV array is still terminated the way this parse expects').toBeGreaterThan(start);

  return [...APP.slice(start, end).matchAll(/\bid: '([^']+)'/g)].map((m) => m[1] as string);
}

describe('every sidebar destination renders something', () => {
  it('found a menu to check, so this file cannot pass by parsing nothing', () => {
    // A guard on the guard. An empty list would satisfy every assertion below while watching
    // nothing at all — the way three assertions in this repo have already gone quiet.
    const ids = navIds();
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(ids).toContain('status');
    expect(ids).toContain('colony-ownership');
  });

  it('★ MANDATORY: no nav entry points at a page that does not exist ★', () => {
    /*
     * `page === '<id>'` is how every destination is dispatched. An id with no such test is a menu
     * row that renders an empty content area — which reads as the app being broken, not as a page
     * being unfinished.
     *
     * `status` is the exception and is handled by falling through rather than by a branch of its
     * own, so it is checked separately above rather than exempted silently here.
     */
    const missing = navIds()
      .filter((id) => id !== 'status')
      .filter((id) => !APP.includes(`page === '${id}'`));

    expect(
      missing,
      'these sidebar entries have no branch in the page dispatch, so clicking them shows nothing',
    ).toEqual([]);
  });
});
