import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The buy-order toggle is REACHABLE, on both surfaces.
 *
 * ★ THIS EXACT FAILURE HAS ALREADY HAPPENED TWICE ★
 *
 * The shopping list's cheapest-versus-closest sort was "implemented end to end on both controllers
 * and no surface ever drew a control", so for weeks the only ordering anybody could get was the
 * default — which is how a shopping list ended up sending somebody ninety-six light years to save
 * five percent.
 *
 * Then the Frontier reconnect button: it existed, it was correct, and it was rendered only by the
 * gate screen you see INSTEAD of the app. Reachable exclusively by people who did not need it.
 *
 * Both were confirmed by reading the source and finding the code present. Presence is not
 * reachability, and only reachability is worth anything to a member. So this asserts the control is
 * DRAWN and WIRED, not that the capability exists.
 */

const companion = (name: string): string => readFileSync(join(process.cwd(), 'src', name), 'utf8');
const web = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), '..', 'web', 'src', ...parts), 'utf8');

const APP = companion(join('renderer', 'colonisation.tsx'));
const CATALOGUE = web('app', '(hub)', 'colonisation', '[id]', 'purchase-catalogue.tsx');

describe('a member can actually change the buy ordering', () => {
  it('★ MANDATORY: the companion draws both choices and re-asks the hub ★', () => {
    expect(APP, 'the toggle must offer both orderings').toContain("['closest', 'Closest']");
    expect(APP).toContain("['ours', 'Ours first']");
    expect(APP, 'and pressing one must change something').toContain('setOrder(value)');

    /*
     * The hub decides the order, so the toggle has to re-ask it. Re-sorting the rows already on
     * screen would disagree with the server the moment a route has more stops than the cap returns
     * — the member would be reordering a truncated list and seeing a different answer from the one
     * the website gives.
     */
    expect(APP, 'the ordering must be sent to the hub').toContain(
      'window.colony.purchases(projectId, order)',
    );
    /*
     * Anchored on the dependency array itself rather than on the nearest `void load()`. There is
     * more than one of those in this file and slicing from the first found a different effect
     * entirely — the assertion passed or failed on which one happened to come first, which is the
     * same wrong-anchor mistake that has made four assertions in this repo green while protecting
     * nothing.
     */
    expect(APP, 'and re-read when it changes').toContain('}, [projectId, order]);');
  });

  it('★ MANDATORY: the website draws both choices, in the URL ★', () => {
    expect(CATALOGUE).toContain("['ours', 'Ours first']");
    expect(CATALOGUE).toContain("['closest', 'Closest']");

    /*
     * A link, not a button with an onClick. One GET parameter belongs in the URL: a refresh, a
     * bookmark and a link pasted into Discord all keep the choice, and it works with no JavaScript.
     */
    expect(CATALOGUE, 'the choice lives in the query string').toContain('buyOrder=closest');
  });

  it('★ MANDATORY: an unrecognised value falls back, it does not invent a third ordering ★', () => {
    /*
     * `?buyOrder=banana` must produce the documented default, not an undefined ordering that
     * happens to be whatever the database returned. Both surfaces narrow to the literal before it
     * travels, so nothing else can reach the API.
     */
    const page = web('app', '(hub)', 'colonisation', '[id]', 'page.tsx');
    expect(page).toContain("query['buyOrder'] === 'closest' ? 'closest' : undefined");
    expect(companion('main.ts')).toContain("order === 'closest' ? 'closest' : undefined");
  });
});
