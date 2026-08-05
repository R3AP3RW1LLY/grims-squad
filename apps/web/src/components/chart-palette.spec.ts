import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The chart palette really is the brand palette.
 *
 * ★ THIS TEST EXISTS BECAUSE A COMMENT CLAIMED IT ALREADY DID ★
 *
 * The old Recharts file said the hex values were "pulled from the generated theme and pinned by a
 * test, because a chart quietly drifting from the brand is exactly the kind of thing nobody
 * notices until it looks wrong beside everything else". The reasoning was right and the test did
 * not exist. Now it does.
 *
 * ★ READ AS TEXT, NOT IMPORTED ★
 *
 * chart-kit.tsx registers Chart.js at module scope, and this assertion is about fourteen string
 * literals — dragging a rendering library into a palette check would make a colour test fail for
 * reasons that have nothing to do with colour.
 */

const ROOT = join(process.cwd(), 'src');
const KIT = readFileSync(join(ROOT, 'components', 'chart-kit.tsx'), 'utf8');
const THEME = readFileSync(join(ROOT, 'app', 'theme.generated.css'), 'utf8');

/** `orange: '#ff7100',` → `#ff7100`. */
function brand(key: string): string | null {
  return new RegExp(`^\\s*${key}: '([^']+)',`, 'm').exec(KIT)?.[1] ?? null;
}

/** `--color-brand-orange: #ff7100;` → `#ff7100`. */
function token(name: string): string | null {
  return new RegExp(`--color-${name}:\\s*([^;]+);`).exec(THEME)?.[1]?.trim() ?? null;
}

/**
 * Every chart colour that IS a brand token, and which one.
 *
 * `hostile` maps to the BRIGHT variant deliberately: the base `#ff2b2b` is forbidden as body text
 * by the contrast checker, and a 2px line on a near-black panel has the same problem.
 */
const MAPPED: ReadonlyArray<readonly [string, string]> = [
  ['orange', 'brand-orange'],
  ['orangeBright', 'brand-orange-bright'],
  ['orangeDim', 'brand-orange-dim'],
  ['cyan', 'brand-cyan'],
  ['cyanBright', 'brand-cyan-bright'],
  ['success', 'semantic-success'],
  ['warning', 'semantic-warning'],
  ['hostile', 'semantic-hostile-bright'],
  ['panel', 'surface-panel'],
  ['panelRaised', 'surface-panel-raised'],
  ['hairline', 'border-hairline'],
  ['text', 'text-primary'],
  ['textSecondary', 'text-secondary'],
  ['void', 'surface-void'],
];

describe('the chart palette', () => {
  it.each(MAPPED)('%s is the %s token', (key, name) => {
    const value = brand(key);
    expect(value, `BRAND.${key} is missing from chart-kit.tsx`).not.toBeNull();
    expect(value).toBe(token(name));
  });

  /*
   * ★ THE TWO COLOURS THAT ARE NOT TOKENS ★
   *
   * Violet and magenta were added for the split activity series — owner, 2026-07-30: "make this
   * line purple", and for voice "choose a seperate color for the voice activity that doesnt match
   * other colors used". They are chart-only, so they are not in the theme, and the ask was
   * explicitly that they not collide with anything already in play.
   */
  it.each([['violet'], ['magenta']])('%s is chart-only and collides with nothing', (key) => {
    const value = brand(key);
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME).not.toContain(value);

    const others = MAPPED.map(([k]) => brand(k));
    expect(others).not.toContain(value);
  });

  it('does not name a colour the theme has since changed under it', () => {
    // A token renamed or dropped in the SSOT makes `token()` return null, and a null on both sides
    // of an equality assertion would pass silently. Checked once, loudly, here.
    for (const [, name] of MAPPED) {
      expect(token(name), `--color-${name} is gone from the generated theme`).not.toBeNull();
    }
  });
});
