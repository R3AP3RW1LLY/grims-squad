import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GalaxyMap } from './galaxy-map';

/**
 * The galaxy map is decoration, so it gets exactly two kinds of test: the ones
 * that catch a silently-wrong render, and the ones that stop it from quietly
 * becoming a data display.
 */
const html = renderToStaticMarkup(<GalaxyMap />);

describe('GalaxyMap', () => {
  it('is hidden from assistive technology — it carries no information', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="presentation"');
  });

  it('renders NO moving parts — the backdrop is static by decision', () => {
    // The human asked for a static hero background on 2026-07-27. Ships,
    // flares, lane flow, twinkle and the rotating reticle are all gone. This
    // test exists because "add a subtle animation" is exactly the kind of
    // change that creeps back in later without anyone weighing the cost of
    // running it every frame behind a full-screen hero.
    for (const cls of ['gm-ship', 'gm-jump', 'gm-transit', 'gm-jump-flare']) {
      expect(html).not.toContain(cls);
    }
    expect(html).not.toContain('--gm-path');
    expect(html).not.toContain('animation');
  });

  it('compensates for the lost motion with density', () => {
    // With nothing moving, detail has to hold the eye instead.
    const stars = [...html.matchAll(/class="gm-star"/g)].length;
    expect(stars).toBeGreaterThanOrEqual(25);
  });


  it('names ONLY the home system, and names it correctly', () => {
    // Inventing plausible system names would present fiction in the same visual
    // language the real BGS data will use later. The one label here is true.
    expect(html).toContain('HYADES SECTOR AV-W b2-4');
    const labels = [...html.matchAll(/class="gm-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(['HYADES SECTOR AV-W b2-4']);
  });

  it('renders no numeric readouts that could be mistaken for live data', () => {
    // No "1,247 CMDRS" or "34.7 LY" anywhere. If a future edit adds a figure to
    // the backdrop, it has to come from real data and this test has to change.
    const text = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1] ?? '').join(' ');
    expect(text).not.toMatch(/\d[\d,.]*\s*(LY|CR|CMDR|%)/i);
  });

  it('every drop line terminates on the galactic plane', () => {
    // The drop line is the detail that makes it read as the in-game map. If one
    // stopped short the whole illusion breaks, and it is easy to miss by eye.
    const drops = [...html.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)];
    const vertical = drops.filter((m) => m[1] === m[3]);
    expect(vertical.length).toBeGreaterThanOrEqual(16);
    for (const m of vertical) expect(Number(m[4])).toBe(470);
  });

  it('places no element using a random value (hydration safety)', () => {
    // Two renders must be byte-identical. A randomised layout would produce
    // different server and client markup and surface as a hydration error.
    expect(renderToStaticMarkup(<GalaxyMap />)).toBe(html);
  });
});
