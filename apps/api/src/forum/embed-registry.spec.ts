import { describe, it, expect } from 'vitest';
import { EmbedRegistry, createEmbedRegistry, NOOP_EMBED_KIND } from './embed-registry.js';

/**
 * The embed extension point (P2.9).
 *
 * A seam, not a feature. The tests are about the SEAM's properties, because those are what a
 * renderer added in P7 will depend on.
 */

describe('the registry ships with a no-op registered', () => {
  it('MANDATORY @P2.9: the extension point exists and is exercised', () => {
    /*
     * Registered rather than merely possible: a registry with nothing in it has never had its
     * register/render path run, so the first real renderer would be the first thing to find a
     * mistake in it.
     */
    const registry = createEmbedRegistry();
    expect(registry.kinds()).toEqual([NOOP_EMBED_KIND]);
    expect(registry.render({ kind: NOOP_EMBED_KIND, data: {} })).toBe('');
  });
});

describe('an unknown kind renders NOTHING', () => {
  it('MANDATORY: not a link, not the payload, not an error containing it', () => {
    /*
     * The security posture, not a placeholder. Rendering the payload "so something appears" would be
     * exactly the hole the document format exists to close: content reaching HTML without a renderer
     * that understands it.
     */
    const out = createEmbedRegistry().render({
      kind: 'station',
      data: { name: '<script>alert(1)</script>', url: 'https://evil.test' },
    });

    expect(out).toBe('');
    expect(out).not.toContain('script');
    expect(out).not.toContain('evil.test');
  });
});

describe('registration is strict', () => {
  it('MANDATORY: refuses to replace an existing renderer', () => {
    /*
     * Two renderers for one kind means one is dead code and which wins depends on import order —
     * not something anybody should have to reason about.
     */
    const r = new EmbedRegistry();
    r.register('station', () => '<div></div>');
    expect(() => r.register('station', () => '<span></span>')).toThrowError(/already registered/);
  });

  it('refuses an empty kind', () => {
    expect(() => new EmbedRegistry().register('  ', () => '')).toThrowError(/cannot be empty/);
  });
});

describe('a broken renderer costs its own space and nothing else', () => {
  it('MANDATORY: a throwing renderer does not take the post down', () => {
    /*
     * A post that fails to render entirely because a station preview hit a null is a far worse
     * outcome than a gap where the preview would have been.
     */
    const r = new EmbedRegistry();
    r.register('station', () => {
      throw new Error('upstream was null');
    });

    expect(r.render({ kind: 'station', data: {} })).toBe('');
  });

  it('does not leak the renderer error to a reader', () => {
    const r = new EmbedRegistry();
    r.register('x', () => {
      throw new Error('SECRET internal detail');
    });
    expect(r.render({ kind: 'x', data: {} })).not.toContain('SECRET');
  });
});

describe('a registered renderer is used', () => {
  it('renders through the registry', () => {
    // Proves the happy path works, so the no-op above is not passing for the wrong reason.
    const r = new EmbedRegistry();
    r.register('ok', (p) => `<div data-kind="${p.kind}"></div>`);
    expect(r.render({ kind: 'ok', data: {} })).toBe('<div data-kind="ok"></div>');
  });
});
