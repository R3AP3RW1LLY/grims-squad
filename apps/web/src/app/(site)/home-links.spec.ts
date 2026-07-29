import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The four facts in the hero card, and where they take a visitor.
 *
 * ★ WHY THESE ARE WORTH A TEST ★
 *
 * They are the first thing anybody sees, three of them are outbound links to
 * sites we do not control, and every one of them was set by hand from an id the
 * squadron owner supplied. A wrong id does not break the build, does not fail a
 * render, and does not look wrong on screen — it quietly sends visitors to
 * another squadron's faction page.
 *
 * Read as SOURCE rather than rendered, because the page is an async server
 * component that fetches GalNet and the squadron stats before it returns
 * anything. Standing that up in jsdom would test the mocks.
 */
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

/**
 * The file explains its own history at length; comments must not match.
 *
 * Line comments are stripped only where `//` STARTS a line. Matching `//`
 * anywhere — the obvious version — ate every URL on the page from `https://`
 * onwards, so every assertion below failed against a file that was correct.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*/gm, '');

describe('hero card links', () => {
  it('sends the home system to the right Inara star system', () => {
    // Squadron owner, 2026-07-29. Moved here from EDSM.
    expect(code).toContain('https://inara.cz/elite/starsystem/778467/');
    expect(code).not.toContain('edsm.net');
  });

  it('names the faction and links to it', () => {
    /*
     * It said "Player Minor Faction" — the CATEGORY of thing the squadron is
     * aligned to, never which one. The most identifying fact about this
     * squadron in the BGS was the one the hero card withheld.
     */
    expect(code).toContain('Blood Brothers from');
    expect(code).toContain('https://inara.cz/elite/minorfaction/5469/');
    expect(code).not.toContain('Player Minor Faction');
  });

  it('sends the platform to the Frontier store', () => {
    expect(code).toContain(
      'https://www.elitedangerous.com/buy/elite-dangerous-deluxe-edition/steam',
    );
  });

  /*
   * A wrap that orphans "Alrai" onto its own line reads as two separate facts
   * rather than one faction's name — the same reason the system name uses
   * non-breaking hyphens. Easy to lose to a "tidy up the whitespace" edit,
   * because the two characters look identical in every editor.
   */
  it('keeps the faction name from wrapping mid-name', () => {
    /*
     * Built from an ESCAPE rather than written as the character itself.
     * A literal non-breaking space in source is invisible in every editor and
     * `no-irregular-whitespace` rejects it — so the assertion says which
     * codepoint it means, in a file that stays pure ASCII.
     */
    expect(code).toMatch(new RegExp('Blood Brothers from\\u00a0Alrai'));
  });
});

describe('outbound links', () => {
  /*
   * ★ EVERY EXTERNAL LINK OPENS IN A NEW TAB ★
   *
   * Squadron owner, 2026-07-29. `rel` is not decoration: without `noopener` the
   * opened page gets a handle on this one through `window.opener` and can
   * navigate it somewhere else, which is a real phishing route and costs one
   * attribute to close.
   *
   * The hero renders all four instruments through ONE anchor, so this is a
   * single assertion rather than one per link — and that is the point of
   * rendering them through one anchor.
   */
  it('opens in a new tab, with rel protection', () => {
    expect(code).toContain("target=\"_blank\"");
    expect(code).toContain('rel="noopener noreferrer"');
  });

  /*
   * ★ THE DESTINATION IS DERIVED, NOT WRITTEN OUT ★
   *
   * The screen-reader hint said "opens EDSM in a new tab" as a literal string.
   * The moment the links moved to Inara it was announcing the wrong destination
   * to exactly the people who cannot see where a link goes — and nothing would
   * ever have caught it, because no test can tell that a sentence has stopped
   * being true.
   */
  it('announces where the link goes, taken from the href', () => {
    expect(code).toContain('linkSite(item.href)');
    expect(code).not.toContain('opens EDSM in a new tab');
  });
});
