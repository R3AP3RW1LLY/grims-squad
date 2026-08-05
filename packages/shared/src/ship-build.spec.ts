import { describe, expect, it } from 'vitest';
import { sourceOf, coverageOf, BUILD_HOSTS, type ShipBuild, type FittedModule } from './ship-build.js';

/**
 * Which links we accept, and what we claim to have read from them.
 *
 * The host check is the security-relevant half: a URL test done on the string rather than on the
 * parsed host is one of the oldest ways to accept something you did not mean to.
 */

const slot = (over: Partial<FittedModule> = {}): FittedModule => ({
  group: 'internal',
  index: 0,
  moduleId: '5A',
  slotSize: 5,
  enabled: true,
  priority: 1,
  engineering: null,
  ...over,
});

const build = (modules: FittedModule[]): ShipBuild => ({
  shipId: 'mandalay',
  shipName: 'Mandalay',
  buildName: null,
  source: 'coriolis',
  sourceUrl: 'https://coriolis.io/outfit/mandalay?code=x',
  bulkheadId: 'Bs',
  modules,
});

describe('sourceOf', () => {
  it('recognises the sites we can read', () => {
    expect(sourceOf('https://coriolis.io/outfit/mandalay?code=abc')).toBe('coriolis');
    expect(sourceOf('https://edsy.org/#/L=abc')).toBe('edsy');
  });

  it('MANDATORY: orbis.zone is Coriolis', () => {
    /*
     * A community-run Coriolis mirror, and by far the most commonly shared form of a Coriolis link.
     * Rejecting it as "unsupported" would be wrong about the most likely input a member pastes.
     */
    expect(sourceOf('https://orbis.zone/?code=abc')).toBe('coriolis');
  });

  it('accepts a www. prefix', () => {
    expect(sourceOf('https://www.coriolis.io/outfit/mandalay?code=abc')).toBe('coriolis');
  });

  it('MANDATORY: matches the HOST, not the string', () => {
    /*
     * ★ THE OLDEST URL BUG THERE IS ★
     *
     * `startsWith('https://coriolis.io')` accepts `https://coriolis.io.evil.test/...`, and a
     * substring test accepts anything containing the name anywhere in it. Parsing and comparing the
     * hostname is the only form that cannot be talked around.
     */
    expect(sourceOf('https://coriolis.io.evil.test/outfit/x?code=y')).toBeNull();
    expect(sourceOf('https://evil.test/?next=https://coriolis.io/outfit/x')).toBeNull();
    expect(sourceOf('https://notcoriolis.io/outfit/x')).toBeNull();
  });

  it('MANDATORY: refuses non-web schemes', () => {
    // A `javascript:` URL carrying a known host would pass a naive hostname check.
    expect(sourceOf('javascript:alert(1)//coriolis.io')).toBeNull();
    expect(sourceOf('data:text/html,coriolis.io')).toBeNull();
    expect(sourceOf('file:///etc/passwd')).toBeNull();
  });

  it('junk is null rather than an exception', () => {
    // The input is a text box. Half a URL pasted out of Discord is the normal failure, not an error.
    expect(sourceOf('')).toBeNull();
    expect(sourceOf('coriolis.io/outfit/mandalay')).toBeNull(); // no scheme
    expect(sourceOf('not a url at all')).toBeNull();
  });

  it('surrounding whitespace is trimmed', () => {
    // Pasting from Discord routinely brings a trailing newline.
    expect(sourceOf('  https://coriolis.io/outfit/mandalay?code=abc\n')).toBe('coriolis');
  });

  it('every declared host resolves', () => {
    for (const host of Object.keys(BUILD_HOSTS)) {
      expect(sourceOf(`https://${host}/x`), host).not.toBeNull();
    }
  });
});

describe('coverageOf', () => {
  it('counts what was read', () => {
    const c = coverageOf(build([slot(), slot({ moduleId: null }), slot({ index: 2 })]));

    expect(c.slotsTotal).toBe(3);
    expect(c.modulesRead).toBe(2);
    expect(c.complete).toBe(true);
  });

  it('counts engineered modules separately', () => {
    const engineered = slot({
      engineering: {
        blueprintId: 'fsd_longrange',
        blueprintName: 'Increased Range',
        grade: 5,
        quality: 1,
        experimentalId: null,
        modifiers: { optmass: 0.25 },
      },
    });

    expect(coverageOf(build([engineered, slot()])).engineeredModules).toBe(1);
  });

  it('MANDATORY: a build with no modules read says so', () => {
    /*
     * What a decoder returns when it recognised the ship and nothing else. Stored silently it would
     * become a STOCK hull — a specific and wrong claim about what somebody flies, and the AI would
     * repeat it.
     */
    const c = coverageOf(build([slot({ moduleId: null }), slot({ moduleId: null, index: 1 })]));

    expect(c.complete).toBe(false);
    expect(c.warnings.join(' ')).toContain('only the ship type');
  });

  it('an empty slot is not a missing module', () => {
    // Members fly with empty slots on purpose. Flagging that as an incomplete import would warn on
    // most real builds and teach people to ignore the warning.
    const c = coverageOf(build([slot(), slot({ moduleId: null, index: 1, slotSize: 6 })]));
    expect(c.complete).toBe(true);
  });
});
