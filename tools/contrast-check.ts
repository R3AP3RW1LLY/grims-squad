#!/usr/bin/env tsx
/**
 * WCAG CONTRAST CHECK
 *
 * Computes the real contrast ratio for every foreground/background pair in
 * ssot/07-design/tokens.json and fails if a pairing that is supposed to pass
 * has dropped below its threshold.
 *
 * This exists because measurement already contradicted an assumption once: the
 * source spec warned that ED orange fails WCAG AA on black, but against our
 * actual surfaces `brand.orange` scores 5.95–7.31 and PASSES — while
 * `text.dim`, `brand.orangeDim` and `semantic.hostile`-on-hover genuinely fail
 * and the rule of thumb would have missed all three.
 *
 * Authoritative results table: ssot/07-design/accessibility.md
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

interface TokenNode {
  $value?: string;
  [k: string]: unknown;
}

const tokens = JSON.parse(readFileSync(resolve(REPO, 'ssot/07-design/tokens.json'), 'utf8')) as
  Record<string, unknown>;

function tokenValue(path: string): string {
  const parts = path.split('.');
  let node: unknown = tokens['color'];
  for (const p of parts) {
    node = (node as Record<string, unknown> | undefined)?.[p];
    if (node === undefined) throw new Error(`Token not found: color.${path}`);
  }
  const v = (node as TokenNode).$value;
  if (typeof v !== 'string') throw new Error(`Token color.${path} has no $value`);
  return v;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['surface.void', 'surface.panel', 'surface.panelRaised', 'surface.panelHover'];

/** Tokens that MUST pass AA for normal body text on every surface. */
const BODY_TEXT = [
  'text.primary',
  'text.secondary',
  'brand.orange',
  'brand.orangeBright',
  'brand.cyan',
  'brand.cyanBright',
  'semantic.hostileBright',
  'semantic.success',
  'semantic.warning',
];

/**
 * Tokens FORBIDDEN for body text — they fail AA and are decorative/disabled only.
 * Listed so a future change that accidentally makes one compliant is noticed,
 * and so nobody "fixes" the check by relaxing it.
 */
const NOT_BODY_TEXT = ['text.dim', 'brand.orangeDim'];

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;

console.log('Contrast pairs computed from ssot/07-design/tokens.json\n');

for (const fg of BODY_TEXT) {
  for (const bg of SURFACES) {
    const r = ratio(tokenValue(fg), tokenValue(bg));
    if (r < AA_NORMAL) {
      failures += 1;
      console.error(
        `${red('FAIL')}  ${fg} on ${bg} = ${r.toFixed(2)} ` +
          `(needs ${AA_NORMAL} for normal text)`,
      );
    } else {
      console.log(`${green(' ok ')}  ${fg.padEnd(24)} on ${bg.padEnd(22)} ${r.toFixed(2)}`);
    }
  }
}

console.log('');
for (const fg of NOT_BODY_TEXT) {
  for (const bg of SURFACES) {
    const r = ratio(tokenValue(fg), tokenValue(bg));
    // These must still clear the 3.0 non-text / large-text bar.
    if (r < AA_LARGE) {
      failures += 1;
      console.error(`${red('FAIL')}  ${fg} on ${bg} = ${r.toFixed(2)} (needs ${AA_LARGE})`);
    } else {
      console.log(
        dim(`  --  ${fg.padEnd(24)} on ${bg.padEnd(22)} ${r.toFixed(2)}  decorative/disabled only`),
      );
    }
  }
}

// Dark-on-bright: filled buttons. Never light text on an accent fill.
console.log('');
const ON_ACCENT = ['brand.orange', 'brand.orangeBright', 'brand.cyan', 'semantic.success',
  'semantic.warning', 'semantic.hostile'];
for (const bg of ON_ACCENT) {
  const r = ratio(tokenValue('text.onAccent'), tokenValue(bg));
  if (r < AA_NORMAL) {
    failures += 1;
    console.error(`${red('FAIL')}  text.onAccent on ${bg} = ${r.toFixed(2)}`);
  } else {
    console.log(`${green(' ok ')}  ${'text.onAccent'.padEnd(24)} on ${bg.padEnd(22)} ${r.toFixed(2)}`);
  }
}

console.log('');
if (failures > 0) {
  console.error(red(`Contrast check FAILED — ${failures} pairing(s) below threshold.`));
  console.error(dim('See ssot/07-design/accessibility.md for the compliant substitutions.'));
  process.exit(1);
}
console.log(green('Contrast check passed.'));
