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

  it('fires each jump flare exactly at the end of its own lane', () => {
    // The subtle bug this guards: the flare coordinate is derived from the same
    // path string the ship travels. If that ever became a hand-maintained copy,
    // nudging a lane would leave the flare firing slightly off the end — wrong
    // in a way that looks almost right and would survive review.
    // React HTML-escapes the quotes inside path("...") to &quot; in the style
    // attribute, so the pattern has to match what is actually SERVED, not what
    // the source looks like.
    const lanes = [...html.matchAll(/--gm-path:\s*path\(&quot;(.+?)&quot;\)/g)].map(
      (m) => m[1] ?? '',
    );
    const flares = [...html.matchAll(/<circle class="gm-jump"[^>]*?cx="([\d.]+)"[^>]*?cy="([\d.]+)"/g)];

    expect(lanes.length).toBeGreaterThan(0);
    expect(flares).toHaveLength(lanes.length / 2); // each lane string appears on ship AND flare

    const uniqueLanes = [...new Set(lanes)];
    for (const [i, flare] of flares.entries()) {
      const d = uniqueLanes[i] ?? '';
      const nums = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
      expect(Number(flare[1])).toBe(Number(nums[nums.length - 2]));
      expect(Number(flare[2])).toBe(Number(nums[nums.length - 1]));
    }
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
