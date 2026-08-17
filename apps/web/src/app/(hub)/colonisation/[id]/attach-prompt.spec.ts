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

/**
 * ★ WHAT THIS SPEC COULD NOT CATCH, AND NOW DOES — 2026-08-17 ★
 *
 * Everything above passed while the prompt was INVISIBLE in the companion for everybody.
 *
 * Each assertion was true: the app renders `<AttachPrompt`, it defaults `data.canAttach ?? []`, it
 * calls `carrierAdd`. All of it correct, and all of it about ONE SIDE OF THE WIRE. The device route
 * — the only way the companion ever reads a project — never put `canAttach` in the payload, so the
 * default fired every time and the prompt was never drawn.
 *
 * That is the module's signature failure once more: two halves each behaving exactly as written,
 * with the data missing in between, and nothing to log because an absent field and an empty list
 * are the same thing to `?? []`.
 *
 * So parity is now asserted across the WIRE as well as across the two renderers: a field a surface
 * renders must be a field its own route sends.
 */
describe('the wire, not just the two renderers', () => {
  const DEVICE = read('../api/src/logistics/colony-device.controller.ts');
  const WEB_ROUTE = read('../api/src/logistics/colony.controller.ts');

  /**
   * The RETURN of a controller method, not the whole file.
   *
   * ★ THE FOURTH TIME THIS TRAP HAS CAUGHT AN ASSERTION TODAY ★
   *
   * `expect(DEVICE).toContain('canAttach')` passed with the field deleted from the payload, because
   * the local `const canAttach = await ...` above it still matched. The test said something true
   * about the file and nothing whatever about what the app receives — which is the exact defect it
   * was written to prevent, reproduced inside its own regression test.
   *
   * Mutation testing caught it. Nothing else would have.
   */
  const payloadOf = (src: string, after: string): string => {
    const from = src.indexOf(after);
    if (from === -1) throw new Error(`no ${after} in this controller`);
    const open = src.indexOf('return {', from);
    if (open === -1) throw new Error('that method returns no object');
    // A newline built rather than escaped. Writing this line through a script turned the escape
    // into a REAL newline and left an unterminated string — the third time that has happened
    // today, so it is simply avoided here.
    const NL = String.fromCharCode(10);
    return src.slice(open, src.indexOf(NL + '    };', open));
  };

  it('★ MANDATORY: the route the COMPANION reads sends canAttach ★', () => {
    /*
     * The website's route computed it from the day the feature landed. This one did not, and the
     * app's own tests could not tell — they were reading the app.
     */
    expect(DEVICE, 'it must be computed').toContain('unattachedHoldingFor');
    expect(
      payloadOf(DEVICE, 'unattachedHoldingFor'),
      'computing it and not sending it is exactly the bug this replaces',
    ).toContain('canAttach,');
  });

  it('★ MANDATORY: both routes send it, so neither surface is the odd one out ★', () => {
    for (const [name, src] of [
      ['the website route', WEB_ROUTE],
      ['the companion route', DEVICE],
    ] as const) {
      expect(payloadOf(src, 'unattachedHoldingFor'), `${name} must send canAttach`).toContain(
        'canAttach,',
      );
      // Owner-scoped on both, and fail-soft on both: a prompt is worth less than the page it is on.
      expect(src, `${name} must not let the prompt fail the page`).toContain('.catch(() => [])');
    }
  });
});

/**
 * ★ A FIGURE THAT CHANGES WHAT SOMEBODY BUYS MUST BE VISIBLE — 2026-08-17 ★
 *
 * `declared` gained a third source when the carrier poller landed. Both surfaces still split it two
 * ways, and BOTH type declarations still said `'journal' | 'manual'` — so neither could even
 * represent a Frontier manifest row.
 *
 * The tonnage counted the whole time: it fed `carrierCover`, which stages the yellow segment on the
 * needs bars and subtracts from the shopping list. A member saw their buy quantity reduced by cargo
 * that appeared nowhere they could inspect or correct, under a "Declared hold" heading with silence
 * beneath it — the empty-state could not fire either, because the list was not empty.
 */
describe('every source that counts is a source you can see', () => {
  const WEB_CARRIERS = read('src/app/(hub)/colonisation/[id]/carriers.tsx');
  const APP = read('../companion/src/renderer/colonisation.tsx');
  const WEB_TYPES = read('src/lib/api.ts');
  const APP_TYPES = read('../companion/src/hub-colony.ts');

  it('★ MANDATORY: both surfaces RENDER cAPI rows ★', () => {
    for (const [name, src] of [
      ['the website', WEB_CARRIERS],
      ['the companion', APP],
    ] as const) {
      expect(src, `${name} must not drop a source that changes the buy quantity`).toContain(
        "d.source === 'capi'",
      );
    }
  });

  it('★ MANDATORY: both surfaces can REPRESENT one ★', () => {
    // The half typecheck found. A union that omits the source is a surface that cannot show it
    // however the rendering is written.
    for (const [name, src] of [
      ['the website', WEB_TYPES],
      ['the companion', APP_TYPES],
    ] as const) {
      expect(src, `${name}'s DeclaredCargo union must include capi`).toContain(
        "'journal' | 'manual' | 'capi'",
      );
    }
  });
});
