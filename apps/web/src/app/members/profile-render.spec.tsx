import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const profilePage = readFileSync(resolve(HERE, '[handle]/page.tsx'), 'utf8');
const rosterPage = readFileSync(resolve(HERE, '../roster/page.tsx'), 'utf8');
const apiClient = readFileSync(resolve(HERE, '../../lib/api.ts'), 'utf8');

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

  it('the roster checks key presence before rendering a location', () => {
    expect(rosterPage).toContain(`'location' in m`);
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
    const meta = profilePage.slice(
      profilePage.indexOf('generateMetadata'),
      profilePage.indexOf('function Row'),
    );
    expect(meta).not.toContain('p.bio');
    expect(meta).toContain('index: false');
  });
});

describe('the roster is opt-in end to end', () => {
  it('renders whatever the API returned without re-filtering it', () => {
    // The filter belongs on the server. A second filter here would look like
    // defence in depth but would actually hide the bug if the server one broke
    // — the page would keep working while the API leaked to every other client.
    expect(rosterPage).not.toContain('showOnPublicRoster');
  });

  it('never caches profile responses', () => {
    // A cached roster keeps showing a member who has just opted out. Correct
    // code, stale answer, same outcome for them.
    expect(apiClient).toContain(`cache: 'no-store'`);
  });
});
