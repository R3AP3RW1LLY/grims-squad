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
        /*
         * Pure redirect: imports `redirect`, returns `never`, and its body is
         * nothing but that call.
         *
         * ★ COMMENTS MAY SIT BETWEEN THE BRACE AND THE CALL ★
         *
         * The previous pattern required `redirect(` IMMEDIATELY after
         * `): never {`, so explaining why a route redirects made the file stop
         * counting as a redirect and fail this test. In a codebase where every
         * decision carries its reasoning, that punished the house style.
         *
         * Comments are stripped before the shape is checked, so the rule still
         * catches a page that redirects conditionally AND renders — which is
         * the case it exists for.
         */
        const withoutComments = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        const isPureRedirect =
          /from 'next\/navigation'/.test(src) &&
          /\): never \{\s*redirect\(/.test(withoutComments);

        /*
         * ★ A PAGE THAT RENDERS NO MARKUP AT ALL ★
         *
         * The `): never {` shape above only recognises a SYNCHRONOUS redirect. A resolver that has
         * to ask the API first — `/members/id/[userId]`, which turns a @mention's user id into a
         * handle — is `async`, can 404, and still never renders anything: both `notFound()` and
         * `redirect()` throw.
         *
         * Checked by the ABSENCE OF JSX rather than by filename, so the exemption cannot be
         * borrowed by a page that grows a body later. The moment such a file returns markup it has
         * a JSX element in it, and this rule applies again — which is the property the test wants.
         */
        const importsNav = /from 'next\/navigation'/.test(src);
        const leavesViaThrow = /(redirect|notFound)\(/.test(withoutComments);
        /*
         * ★ THE SLASH IS OUTSIDE THE CHARACTER CLASS ON PURPOSE ★
         *
         * Written as `[\s/>]` this silently stopped working: esbuild's .tsx lexer ends the regex
         * literal at that slash, so the expression compiled to something other than it reads as
         * and the whole check quietly evaluated false. Escaping it inside the class fixes the lexer
         * and then trips `no-useless-escape`, because inside a class the escape IS unnecessary.
         *
         * An alternation moves the slash where escaping it is both required and honest.
         */
        const hasJsx = /<[A-Za-z][A-Za-z0-9]*(?:[\s>]|\/)/.test(withoutComments);
        const rendersNothing = importsNav && leavesViaThrow && !hasJsx;

        return !isPureRedirect && !rendersNothing;
      })
      .map((p) => p.slice(HUB.length + 1));

    expect(offenders).toEqual([]);
  });
});
