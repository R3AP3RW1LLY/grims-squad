import { describe, it, expect } from 'vitest';
import { CmdrController } from './cmdr.controller.js';

/**
 * What the website is told about a member's Frontier link.
 *
 * ★ THE SITE OWNED THIS FLOW AND COULD NOT SEE IT — 2026-08-17 ★
 *
 * `CapiService.status()` has existed since the Frontier link shipped, and the companion app has
 * always read it. The website never could: there was no route. So the site that hosts the connect
 * button, and that Frontier's own callback redirects INTO, had no way to say whether a member was
 * connected, how long was left, or that anything had gone wrong.
 *
 * ★ WHAT THIS PINS, AND WHY IT IS NOT PLUMBING ★
 *
 * `status()` answers `null` for "this member has never linked" — a real answer, and a different
 * one from "the call failed". Returned bare, both arrive at the browser as an empty-ish body and
 * the panel cannot tell them apart. It would render an API outage as "Not connected to Frontier",
 * which is the one sentence that sends somebody to redo a link they already have.
 *
 * The wrapper is what keeps them distinguishable, so the wrapper is what is tested.
 */

/** The route under test needs one collaborator; the rest are never reached on this path. */
function controllerWith(capi: { status(userId: string): Promise<unknown> }): CmdrController {
  return new CmdrController(
    null as never,
    null as never,
    null as never,
    capi as never,
    null as never,
  );
}

const CALLER = { userId: 'u1' } as never;

describe('GET /v1/me/capi', () => {
  it('reports a live link with the hub’s own sentence', async () => {
    /*
     * The words come from `status()` and are passed through untouched. The site must not compute
     * "days left" from a date of its own — two opinions about one deadline is how the website and
     * the companion app end up telling one member different things about one link.
     */
    const linked = { linked: true, daysLeft: 22, warn: false, sentence: '22 days left' };
    const result = await controllerWith({ status: () => Promise.resolve(linked) }).capiStatus(CALLER);

    expect(result).toEqual({ frontier: linked });
  });

  it('★ MANDATORY: "never linked" is a real answer, not an empty response ★', async () => {
    const result = await controllerWith({ status: () => Promise.resolve(null) }).capiStatus(CALLER);

    /*
     * The key is PRESENT and its value is null. A bare `null` body — which is what returning
     * `status()` directly would produce — is indistinguishable from an empty or failed response to
     * anything that parses it, and the panel's three states collapse into two.
     */
    expect(result).toEqual({ frontier: null });
    expect(Object.keys(result)).toContain('frontier');
  });

  it('asks about the caller, and nobody else', async () => {
    // The userId comes from the session, never from the request. There is no parameter to supply
    // one, and this asserts the route did not acquire the habit of trusting anything else.
    const asked: string[] = [];
    await controllerWith({
      status: (userId: string) => {
        asked.push(userId);
        return Promise.resolve(null);
      },
    }).capiStatus(CALLER);

    expect(asked).toEqual(['u1']);
  });

  it('refuses an unauthenticated caller rather than answering about nobody', async () => {
    await expect(
      controllerWith({ status: () => Promise.resolve(null) }).capiStatus(undefined),
    ).rejects.toThrow();
  });
});
