import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Your carrier is holding 800 t this build needs — attach it?", on both screens.
 *
 * ★ SQUADRON OWNER, 2026-08-16 ★
 *
 * Asked who should see this and where, the answer was: the carrier's owner, on the project page.
 *
 * ★ WHY ONE SPEC COVERS BOTH SURFACES ★
 *
 * This is one feature on two screens, and the failure it exists to prevent is them drifting apart —
 * the website offering a prompt the app never shows, or the two quoting different tonnages for the
 * same carrier. Asserting them in separate files is how that drift goes unnoticed for a release.
 *
 * The same reasoning as `connect-frontier.spec.ts`, which reads the companion's main process from
 * here for exactly this reason: half a feature is a dead end, and half a feature passes its own
 * half's tests.
 */

const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

const read = (f: string): string => strip(readFileSync(join(process.cwd(), f), 'utf8'));

const WEB_PAGE = read('src/app/(hub)/colonisation/[id]/page.tsx');
const WEB_PROMPT = read('src/app/(hub)/colonisation/[id]/attach-prompt.tsx');
const APP_SCREEN = read('../companion/src/renderer/colonisation.tsx');

describe('the website shows it', () => {
  it('★ MANDATORY: the project page renders the prompt ★', () => {
    // The API has returned `canAttach` since the backend landed. Nothing rendered it, which is a
    // prompt with no addressee — the same shape of dead end as a route with no caller.
    expect(WEB_PAGE).toContain('<AttachPrompt');
    expect(WEB_PAGE).toContain('holdings={canAttach}');
  });

  it('★ MANDATORY: it is ABOVE the tabs, not inside the carriers one ★', () => {
    /*
     * The carriers tab is where somebody goes who already knows a carrier is involved. This prompt
     * is for the member who does not, and hiding it behind the tab they have never opened makes it
     * useless to precisely the person it was built for.
     *
     * Asserted positionally because that is the actual claim: the render site must come before the
     * first tab guard on the page.
     */
    const prompt = WEB_PAGE.indexOf('<AttachPrompt');
    const firstTabGuard = WEB_PAGE.indexOf('{tab !== ');

    expect(prompt, 'the prompt must be rendered at all').toBeGreaterThan(-1);
    expect(firstTabGuard, 'the page must still have tabs').toBeGreaterThan(-1);
    expect(prompt, 'a prompt inside a tab is one the member never sees').toBeLessThan(firstTabGuard);
  });

  it('★ MANDATORY: attaching goes to the carriers endpoint ★', () => {
    expect(WEB_PROMPT).toContain('/carriers');
    expect(WEB_PROMPT).toContain('{ marketId }');
  });
});

describe('the app shows it too', () => {
  it('★ MANDATORY: the project screen renders the prompt ★', () => {
    expect(APP_SCREEN).toContain('<AttachPrompt');
    expect(APP_SCREEN).toContain('window.colony.carrierAdd(projectId, { marketId, isSquadron: false })');
  });

  it('★ MANDATORY: it is ABOVE the tabs there as well ★', () => {
    // Same claim, same reason. Parity is the point: a prompt on one surface only is a feature
    // half the squadron never sees, and half of it passes its own half's tests.
    const prompt = APP_SCREEN.indexOf('<AttachPrompt');
    const firstTabGuard = APP_SCREEN.indexOf("{tab !== 'carriers'");

    expect(prompt).toBeGreaterThan(-1);
    expect(firstTabGuard).toBeGreaterThan(-1);
    expect(prompt).toBeLessThan(firstTabGuard);
  });

  it('★ MANDATORY: an older hub that sends no such field does not break the screen ★', () => {
    /*
     * The hub deploys without asking anybody to update, so every member runs a mismatched pair for
     * some window. `data.canAttach.filter(...)` on a hub that sends nothing throws during render,
     * and Preact unmounts the whole panel — which is how two tabs went blank once already.
     */
    expect(APP_SCREEN).toContain('data.canAttach ?? []');
  });
});

/**
 * ★ THE COMPANION'S WINDOW IS THE COMPONENT, NOT THE FILE ★
 *
 * `colonisation.tsx` is the app's whole colonisation screen — every panel, every tab, three thousand
 * lines. A claim like "this component does not sum the lines itself" asserted against the file is
 * answered by some unrelated chart's `reduce`, and says nothing at all about the prompt.
 *
 * This is the third time today an assertion has been rescued by bounding its window: two matched
 * other methods in one service, one matched a comment. Nothing but mutation testing finds them.
 */
const APP_PROMPT = ((): string => {
  const start = APP_SCREEN.indexOf('function AttachPrompt(');
  if (start === -1) throw new Error('the app no longer has an attach prompt');
  const end = APP_SCREEN.indexOf('\nfunction ', start + 1);
  return APP_SCREEN.slice(start, end === -1 ? undefined : end);
})();

describe('what both surfaces say', () => {
  /*
   * Read as a pair on purpose. Every claim below is about the two agreeing, and checking them one
   * file at a time is what lets them drift.
   */
  const both: readonly [string, string][] = [
    ['website', WEB_PROMPT],
    ['companion', APP_PROMPT],
  ];

  it('★ MANDATORY: neither re-derives the tonnage ★', () => {
    /*
     * The hub groups per carrier and clamps each figure to what the build still needs. A surface
     * that sums the lines itself would disagree the moment the clamp mattered — and this module has
     * produced two components each behaving correctly with the number changing between them more
     * than once.
     */
    for (const [surface, src] of both) {
      expect(src, `${surface} must print the hub's total`).toContain('h.tonnes');
      expect(src, `${surface} must not add the lines up itself`).not.toContain('reduce(');
    }
  });

  it('★ MANDATORY: both name the commodities, not just a total ★', () => {
    // "800 t this build needs" could be one commodity it is desperate for or eight it barely wants.
    // A prompt that will not say what it is about is one people learn to dismiss unread.
    for (const [surface, src] of both) {
      expect(src, `${surface} must break the total down`).toContain('h.lines.map');
    }
  });

  it('both can be dismissed for the visit', () => {
    // A prompt with no way to say "not now" is a nag, and a member who cannot dismiss one learns to
    // ignore the space it occupies — including the next thing that appears there.
    for (const [surface, src] of both) {
      expect(src, `${surface} needs a way out`).toContain('Not now');
      expect(src).toContain('setHidden');
    }
  });
});
