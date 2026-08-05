import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foundersFirst, squadronFounders, FOUNDERS_TAB, type Pinned } from './roster-order';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the founders sit on the roster.
 *
 * ★ EVERY ONE OF THESE RULES FAILS SILENTLY ★
 *
 * A roster in the wrong order still renders a roster. A Founders tab listing the
 * wrong four people still lists four people. Nothing throws, nothing logs, and
 * the person who notices is the squadron owner, who asked for this by name on
 * 2026-08-04.
 */

/** The three roles as the migration seeds them. Lower precedence is more senior. */
const FOUNDER = { title: 'Founder', precedence: 800, foundedSquadron: true };
const CO_FOUNDER = { title: 'Co-Founder', precedence: 810, foundedSquadron: true };
const HUB_FOUNDER = { title: 'Founder', precedence: 820, foundedSquadron: false };

interface Member extends Pinned {
  readonly handle: string;
  readonly isOfficer: boolean;
}

const m = (handle: string, over: Partial<Member> = {}): Member => ({
  handle,
  isOfficer: false,
  founder: null,
  ...over,
});

/**
 * The squadron as production holds it, in the order the API sends it —
 * `joinedAt` ascending, which is the roster's existing order.
 *
 * Deliberately NOT already in founder order: the whole point of the sort is that
 * it works on the order the API actually returns, and Mr Grimsoul is seventh in
 * it.
 */
const squadron = (): Member[] => [
  m('r3ap3ractual_22545', { founder: HUB_FOUNDER }),
  m('mynameismike187', { founder: CO_FOUNDER, isOfficer: true }),
  m('saintvic', { founder: CO_FOUNDER, isOfficer: true }),
  m('strwbryvixie'),
  m('madhatter100690'),
  m('smokeyenigma', { isOfficer: true }),
  m('mrgrimsoul', { founder: FOUNDER, isOfficer: true }),
  m('talenmaclir', { founder: CO_FOUNDER, isOfficer: true }),
  m('n_o_d_o'),
];

describe('the all-members order', () => {
  it('MANDATORY: Mr Grimsoul takes the #1 spot, then the founders, then the hub founder', () => {
    /*
     * "they should always be listed at the top of the all members tab with Mr
     *  Grimsoul in the #1 spot, then after the founders, Pebblemerchant should
     *  always be directly after them on the all members page."
     */
    expect(foundersFirst(squadron()).slice(0, 5).map((x) => x.handle)).toEqual([
      'mrgrimsoul',
      'mynameismike187',
      'saintvic',
      'talenmaclir',
      'r3ap3ractual_22545',
    ]);
  });

  it('MANDATORY: leaves everybody else in the order the API sent them', () => {
    /*
     * The pinned block is a small change to the TOP of the roster, not a re-sort
     * of the whole squadron. The rest still arrives oldest account first, and a
     * hundred members reshuffling because five were pinned would be a far bigger
     * change than the one that was asked for.
     */
    const rest = foundersFirst(squadron())
      .slice(5)
      .map((x) => x.handle);
    expect(rest).toEqual(['strwbryvixie', 'madhatter100690', 'smokeyenigma', 'n_o_d_o']);
  });

  it('MANDATORY: co-founders sharing one precedence keep their existing order', () => {
    /*
     * The three co-founders hold ONE role and therefore one precedence, so the
     * only thing deciding their order is the order they arrived in. An unstable
     * sort would shuffle them between page loads with nothing having changed,
     * and a roster that reorders itself under the reader looks broken.
     */
    const ordered = foundersFirst(squadron()).map((x) => x.handle);
    const reversedInput = foundersFirst([...squadron()].reverse()).map((x) => x.handle);

    expect(ordered.slice(1, 4)).toEqual(['mynameismike187', 'saintvic', 'talenmaclir']);
    expect(reversedInput.slice(1, 4)).toEqual(['talenmaclir', 'saintvic', 'mynameismike187']);
  });

  it('MANDATORY: a member with no founding role is unaffected', () => {
    // A roster of ordinary members comes back exactly as it went in.
    const plain = [m('a'), m('b'), m('c')];
    expect(foundersFirst(plain).map((x) => x.handle)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the list it was given', () => {
    // The page derives four tabs from one array. A sort in place would leave
    // whichever tab read it second looking at a list the first had rearranged.
    const input = squadron();
    foundersFirst(input);
    expect(input[0]?.handle).toBe('r3ap3ractual_22545');
  });
});

describe('the members tab', () => {
  it('MANDATORY: opens with Pebblemerchant', () => {
    /*
     * "and should be the first person listed on the Members page please!"
     *
     * Achieved with no special case: the Members tab is the officers filtered
     * out of the founders-first list, and Pebblemerchant is the only holder of
     * founding standing who is not an officer.
     */
    const members = foundersFirst(squadron()).filter((x) => !x.isOfficer);
    expect(members.map((x) => x.handle)).toEqual([
      'r3ap3ractual_22545',
      'strwbryvixie',
      'madhatter100690',
      'n_o_d_o',
    ]);
  });
});

describe('the founders tab', () => {
  it('MANDATORY: lists exactly the four the owner named, in precedence order', () => {
    /*
     * "add only these people to that tab please! GMSD Aurelian Voss
     *  (Co-Founder), Vowser (Co-Founder), Mr Grimsoul (Founder), TYCHICUS
     *  MACEDON (Co-Founder)".
     */
    expect(squadronFounders(foundersFirst(squadron())).map((x) => x.handle)).toEqual([
      'mrgrimsoul',
      'mynameismike187',
      'saintvic',
      'talenmaclir',
    ]);
  });

  it('MANDATORY: the hub founder is titled Founder and is NOT on it', () => {
    /*
     * The owner's instruction holds both halves at once: Pebblemerchant's card
     * "should say founder", and the tab gets four names, theirs not among them,
     * with Pebblemerchant placed "after the founders" — which reads them as
     * somebody who sits behind that group rather than inside it.
     */
    const pebble = m('r3ap3ractual_22545', { founder: HUB_FOUNDER });
    expect(pebble.founder?.title).toBe('Founder');
    expect(squadronFounders([pebble])).toEqual([]);
  });

  it('MANDATORY: an ordinary member is never on it', () => {
    expect(squadronFounders([m('a'), m('b')])).toEqual([]);
  });

  it('MANDATORY: the page offers the tab this module names', () => {
    /*
     * The key is a URL. A page whose tab said `?tab=founders` while this module
     * filtered on something else would render the whole roster under a Founders
     * heading — a page that works, showing the wrong thing.
     */
    const page = readFileSync(resolve(HERE, 'page.tsx'), 'utf8');
    expect(page).toContain('FOUNDERS_TAB');
    expect(page).toContain("label: 'Founders'");
    expect(FOUNDERS_TAB).toBe('founders');
  });
});

describe('what this module is NOT allowed to know', () => {
  it('MANDATORY: no member is named in the source', () => {
    /*
     * The order comes from `founder.precedence`, which is `roles.rank_order` on
     * the role they hold — so the owner reorders the pins, renames the titles or
     * makes somebody else a founder from /app -> Roles, with no deploy.
     *
     * A display name in here would break the day one of them was renamed, and a
     * handle would break the day one of them made a new account. Same doctrine
     * as INV-008 for snowflakes: identity belongs in data.
     */
    const source = readFileSync(resolve(HERE, 'roster-order.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const name of ['Grimsoul', 'Pebble', 'Vowser', 'Voss', 'MACEDON', 'mrgrimsoul']) {
      expect(source, `${name} is named in code`).not.toContain(name);
    }
  });
});
