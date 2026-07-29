import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const profilePage = readFileSync(resolve(HERE, '[handle]/page.tsx'), 'utf8');
const rosterPage = readFileSync(resolve(HERE, '../roster/page.tsx'), 'utf8');
const apiClient = readFileSync(resolve(HERE, '../../../lib/api.ts'), 'utf8');

/**
 * Source with comments stripped.
 *
 * The roster page EXPLAINS, in prose, that the server filters by
 * `showOnPublicRoster` — and an earlier version of the assertion below matched
 * that explanation and failed. A test that fails on its own documentation is a
 * test people learn to delete.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/**
 * @INV-027 on the rendering side.
 *
 * The API omits a field the member has not opted into. That only stays true
 * end-to-end if the PAGE distinguishes an absent key from a present-but-empty
 * value — `p.credits != null` alone treats "chose not to share" and "shared,
 * nothing recorded yet" identically, and renders the same em-dash for both.
 * That is a small lie about a privacy setting, and it is the exact shape this
 * would regress into if someone simplified the conditionals.
 *
 * These are source assertions rather than DOM assertions on purpose: the thing
 * being protected is which CHECK is written, and a rendered snapshot of a
 * profile with everything hidden looks identical either way.
 */
describe('@INV-027 profile rendering distinguishes absent from empty', () => {
  it('gates each privacy-controlled block on the KEY being present', () => {
    for (const field of ['location', 'credits', 'fleet', 'activity']) {
      expect(profilePage, `${field} must be gated on key presence`).toContain(`'${field}' in p`);
    }
  });

  it('does not gate a privacy field on its value alone', () => {
    // The failure mode: `{p.credits != null && ...}` with no `in` check above
    // it. Each field must appear in an `in` test somewhere in the file.
    for (const field of ['location', 'credits', 'fleet']) {
      const keyChecks = profilePage.split(`'${field}' in p`).length - 1;
      expect(keyChecks, `${field} needs a key-presence gate`).toBeGreaterThan(0);
    }
  });

  it('MANDATORY: the roster card checks key presence before rendering a location', () => {
    /*
     * The card moved out of the page into its own component when the roster
     * gained avatars and journal data. The RULE did not move: a location is
     * rendered only when the KEY is present, because the API omits a field the
     * member did not opt into — and `member.location != null` alone would read
     * the same for "opted out" and "opted in with nothing recorded".
     */
    const card = readFileSync(resolve(HERE, '../../../components/roster-card.tsx'), 'utf8');
    expect(card).toContain(`'location' in member`);
  });

  it('MANDATORY: the roster card shows no field that needs consent it cannot see', () => {
    /*
     * Ranks, ship and last-played come from the BASELINE journal categories and
     * are shown to members. Credits and fleet are NOT — they have their own
     * toggles, and a card is exactly where somebody would add them "just to
     * make it look fuller".
     */
    const card = code(readFileSync(resolve(HERE, '../../../components/roster-card.tsx'), 'utf8'));

    expect(card).not.toContain('member.credits');
    expect(card).not.toContain('member.fleet');
  });

  it('MANDATORY: the client type declares gated fields OPTIONAL, not just nullable', () => {
    // `credits: string | null` would compile against a response that omits the
    // key while telling every reader the field is always there. `credits?:`
    // makes absence part of the type, so a component that assumes otherwise
    // fails to typecheck rather than at runtime.
    for (const field of ['location', 'credits', 'fleet', 'activity']) {
      expect(apiClient, `${field} must be optional in PublicProfile`).toMatch(
        new RegExp(`${field}\\?:`),
      );
    }
  });

  it('formats credits through BigInt, never Number', () => {
    // Balances exceed 2^53. Number(p.credits) would round silently and display
    // a wrong figure with total confidence.
    expect(profilePage).toContain('BigInt(p.credits)');
    expect(profilePage).not.toMatch(/Number\(\s*p\.credits/);
  });

  it('does not put a member bio into page metadata', () => {
    // A search-engine snippet is a much wider audience than a profile page, and
    // the member wrote those words for the squadron.
    /*
     * ★ THE SLICE ENDS AT ITS OWN CLOSING BRACE ★
     *
     * This used to end at `function Row` — the helper that happened to follow
     * it. When the page was rebuilt that helper was renamed, `indexOf` returned
     * -1, and `slice(start, -1)` quietly scanned the ENTIRE FILE instead. The
     * test then failed on the bio in the render body: a false alarm about
     * correct code, which is exactly as costly as a missed one.
     *
     * A top-level `\n}` is the end of the function whatever its neighbours are
     * called.
     */
    const start = profilePage.indexOf('generateMetadata');
    expect(start).toBeGreaterThan(-1);

    /*
     * A closing brace ALONE on its line, which is the end of the function. A
     * bare `\n}` also matches the `}: {` that closes the destructured
     * parameters two lines in, cutting the slice to nothing — and a slice of
     * nothing passes a `not.toContain` for entirely the wrong reason.
     */
    const rest = profilePage.slice(start);
    const close = /\r?\n\}\r?\n/.exec(rest);
    expect(close).not.toBeNull();

    const meta = rest.slice(0, close?.index);
    expect(meta).not.toContain('p.bio');
    expect(meta).toContain('index: false');
  });
});

describe('the roster is members-only', () => {
  it('MANDATORY: neither endpoint is @Public', () => {
    /*
     * Gating the PAGE alone would be theatre — the data would be one curl away,
     * and an endpoint that answers anybody is public however the interface is
     * arranged.
     *
     * Anchored on the DECORATORS, in comment-stripped source, and looking
     * BACKWARDS from each route. Two earlier attempts got this wrong in the
     * same way: they sliced a region that began inside the doc comment
     * explaining why @Public was removed, so the stripper had no opening
     * delimiter to match and the prose counted as code.
     */
    const controller = code(
      readFileSync(resolve(HERE, '../../../../../api/src/members/members.controller.ts'), 'utf8'),
    );

    for (const route of ["@Get('members')", "@Get('members/:handle')"]) {
      const at = controller.indexOf(route);
      expect(at, route).toBeGreaterThan(-1);

      // Decorators stack above the route, so @Public would sit just before it.
      const decorators = controller.slice(Math.max(0, at - 200), at);
      expect(decorators, route).not.toContain('@Public');
    }
  });

  it('MANDATORY: lives under (hub), so the layout gates it', () => {
    // The (hub) layout redirects a signed-out visitor before any page renders.
    // A roster under (site) would render for anybody who reached it.
    expect(HERE).toContain('(hub)');
  });
});

describe('the roster is opt-in end to end', () => {
  it('renders whatever the API returned without re-filtering it', () => {
    // The filter belongs on the server. A second filter here would look like
    // defence in depth but would actually hide the bug if the server one broke
    // — the page would keep working while the API leaked to every other client.
    expect(code(rosterPage)).not.toContain('showOnPublicRoster');
  });

  it('never caches profile responses', () => {
    // A cached roster keeps showing a member who has just opted out. Correct
    // code, stale answer, same outcome for them.
    expect(apiClient).toContain(`cache: 'no-store'`);
  });
});
