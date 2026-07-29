import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = join(SRC, 'app', '(hub)');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

const hubPages = pages(HUB);

/**
 * The members-area page shell.
 *
 * ★ THE BUG THIS CAUGHT ★
 *
 * When the sidebar shell landed it started rendering `<main id="main">` around
 * every page — but every page was ALREADY rendering its own. Two <main>
 * elements, nested, with the same id.
 *
 * Invalid HTML, and worse than merely untidy: the skip link at the top of every
 * page targets `#main`, so the one control a keyboard user relies on to escape
 * the navigation was pointing at an ambiguous target. Nothing looked wrong.
 */
describe('hub pages', () => {
  it('MANDATORY: none renders its own <main>', () => {
    const offenders = hubPages
      .filter((p) => /<main[\s>]/.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(HUB.length + 1));

    expect(
      offenders,
      `The (hub) layout already provides <main id="main">. A second one nested ` +
        `inside it duplicates the id the skip link targets, which breaks the ` +
        `one control a keyboard user has for skipping the navigation:\n` +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('MANDATORY: none re-centres itself in its own narrow column', () => {
    /*
     * Every page used to wrap itself in `mx-auto max-w-[70ch]`, which was right
     * for a full-bleed layout and wrong inside a shell that already has a
     * sidebar and its own padding. The result was a narrow ribbon of content
     * with a wide empty gutter — the thing this work was to fix.
     *
     * Readable measure still matters, and is applied INSIDE the page furniture
     * (PageBody, Section) where it constrains prose without constraining a
     * table.
     */
    const offenders = hubPages
      .filter((p) => /mx-auto max-w-\[(70|60|62|52)ch\]/.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(HUB.length + 1));

    expect(offenders).toEqual([]);
  });

  it('MANDATORY: no page tells a signed-in member to sign in', () => {
    /*
     * Each page had a `data === null` branch rendering "Sign in with Discord".
     * That branch became unreachable when the (hub) layout started redirecting
     * signed-out visitors — so the only way to reach it was for the API to be
     * DOWN, and it told the member to do the one thing that could not possibly
     * help. CouldNotLoad says what actually happened.
     */
    const offenders = hubPages
      .filter((p) => /Sign in (to|with)/i.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(HUB.length + 1));

    expect(
      offenders,
      `These render a sign-in prompt, which is unreachable: the (hub) layout ` +
        `redirects a signed-out visitor before any page renders. Use ` +
        `CouldNotLoad, which describes what actually went wrong:\n` +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('every hub page that RENDERS uses the shared header', () => {
    /*
     * Not style policing: PageHeader is what keeps the eyebrow, title size and
     * rule consistent, and a page that rolls its own drifts the moment one of
     * them changes.
     *
     * ★ A REDIRECT IS NOT A PAGE ★
     *
     * Privacy, Security and Account became tabs on Commander Management, and
     * their old routes now exist only to redirect — those URLs are in members'
     * bookmarks and quite possibly a pinned Discord message, so a 404 would be
     * a broken promise for no benefit.
     *
     * A file whose whole body is `redirect(...)` has no header because it has
     * no output. Exempting them by SHAPE rather than by name means the next one
     * is covered automatically, and a page that redirects conditionally and
     * also renders is still held to the rule.
     */
    const offenders = hubPages
      .filter((p) => {
        const src = readFileSync(p, 'utf8');
        if (src.includes('PageHeader')) return false;
        // Pure redirect: imports `redirect` and returns `never`.
        const isPureRedirect =
          /from 'next\/navigation'/.test(src) && /\): never \{\s*redirect\(/.test(src);
        return !isPureRedirect;
      })
      .map((p) => p.slice(HUB.length + 1));

    expect(offenders).toEqual([]);
  });
});
