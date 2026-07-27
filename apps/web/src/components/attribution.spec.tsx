import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteFooter } from './site-chrome';

/**
 * @INV-029 The Frontier non-commercial attribution notice is present on every
 * rendered page.
 *
 * This is a licensing obligation, not a nicety: the permission to use Elite
 * Dangerous assets and imagery is conditional on carrying it. A page that
 * quietly drops it puts the whole site outside the terms it relies on.
 *
 * Rendering the footer to static markup keeps the test honest without a browser.
 * The structural guarantee is that SiteFooter lives in the ROOT LAYOUT — a new
 * page cannot omit it by forgetting, only by deliberately removing it from the
 * layout, which is a far more visible act.
 */
describe('Frontier attribution @INV-029', () => {
  const html = renderToStaticMarkup(<SiteFooter />);

  it('names Frontier Developments and the non-commercial permission', () => {
    expect(html).toContain('Frontier Developments plc');
    expect(html).toContain('non-commercial purposes');
  });

  it('carries the explicit non-endorsement wording', () => {
    expect(html).toContain('Not endorsed by Frontier Developments');
    expect(html).toMatch(/no\s+Frontier Developments employee was involved/);
  });

  it('credits Coriolis for the ship-fit mathematics', () => {
    // MIT permits reuse; it does not permit dropping the attribution.
    expect(html).toContain('Coriolis');
  });

  it('is plain rendered text, not hidden from assistive technology', () => {
    // An attribution behind aria-hidden or display:none would satisfy a naive
    // string check while failing the obligation it exists to meet.
    expect(html).not.toMatch(/aria-hidden="true"[^>]*>[^<]*Frontier Developments plc/);
    expect(html).not.toMatch(/display:\s*none[^"]*"[^>]*>[^<]*Frontier/);
  });

  it('links to the privacy policy and terms from every page', () => {
    // Asserted against RENDERED markup, so a refactor of how the list is built
    // cannot break the test while the links still work — nor pass while they
    // have quietly gone. The footer lives in the root layout, so this covers
    // every page.
    expect(html).toMatch(/href="\/privacy"/);
    expect(html).toMatch(/href="\/terms"/);
    expect(html).toContain('LEGAL');
  });
});
