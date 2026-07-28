import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every design token a component names actually exists.
 *
 * ★ THE BUG THIS CAUGHT ★
 *
 * `--color-text-muted` was used SIXTY-SEVEN times across eighteen files, and
 * was never defined anywhere. CSS does not complain about that — an undefined
 * variable makes the whole declaration invalid, so the element silently
 * inherits its parent's colour.
 *
 * The result: every piece of "muted" secondary text on the site rendered at
 * full primary brightness. Nothing failed, nothing logged, and the only symptom
 * was a design that looked slightly wrong in a way nobody could point at.
 *
 * That is exactly the failure mode a test is for. A typo in a token name is now
 * a red test rather than a subtle visual regression nobody traces for months.
 */

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(WEB, 'src');

/** Every `--color-*` (and friends) the stylesheets actually define. */
function definedTokens(): Set<string> {
  const css = [
    readFileSync(join(SRC, 'app', 'theme.generated.css'), 'utf8'),
    readFileSync(join(SRC, 'app', 'globals.css'), 'utf8'),
  ].join('\n');

  const defined = new Set<string>();
  // A DEFINITION is `--name:`; a USE is `var(--name)`. Matching on the colon is
  // what tells them apart.
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    defined.add(match[1] as string);
  }
  return defined;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // Specs excluded: this file's own prose mentions var(--token) as an
    // example, and a test that fails on its own documentation is a test people
    // learn to ignore.
    if (path.endsWith('.spec.ts') || path.endsWith('.spec.tsx')) return [];
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : [];
  });
}

describe('design tokens', () => {
  it('MANDATORY: every var(--token) a component uses is defined', () => {
    const defined = definedTokens();
    const missing = new Map<string, string[]>();

    for (const path of sourceFiles(SRC)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        const token = match[1] as string;
        if (defined.has(token)) continue;

        const where = missing.get(token) ?? [];
        const relative = path.slice(SRC.length + 1);
        if (!where.includes(relative)) where.push(relative);
        missing.set(token, where);
      }
    }

    const report = [...missing.entries()]
      .map(([token, files]) => `  ${token} — ${files.length} file(s), e.g. ${files[0]}`)
      .join('\n');

    expect(
      [...missing.keys()],
      `These CSS variables are used but never defined. CSS does not warn about ` +
        `this: the declaration is simply invalid and the element inherits its ` +
        `parent's value, so the page looks subtly wrong and nothing fails.\n${report}`,
    ).toEqual([]);
  });

  it('the stylesheets define the tokens the design system promises', () => {
    // A spot check that the generated theme actually loaded. If this fails the
    // test above would pass vacuously by declaring everything missing.
    const defined = definedTokens();
    for (const token of [
      '--color-brand-orange',
      '--color-text-primary',
      '--color-text-secondary',
      '--color-surface-panel',
      '--color-border-hairline',
    ]) {
      expect(defined, token).toContain(token);
    }
  });
});
