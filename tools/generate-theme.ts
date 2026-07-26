/**
 * Generates the Tailwind v4 `@theme` block from ssot/07-design/tokens.json.
 *
 * Tailwind v4 is configless: the theme IS CSS custom properties inside an
 * `@theme` block, which is what makes generating it from the token file
 * practical rather than aspirational. Every `--color-*` here becomes a real
 * utility (`bg-surface-panel`, `text-brand-orange-bright`) with no config file
 * in between.
 *
 * Emitted as its OWN file, imported by globals.css. The previous arrangement
 * put a "GENERATED — do not edit by hand" banner on top of a file that nothing
 * generated and that was full of hand-written CSS. A banner nobody can obey is
 * worse than no banner: it trains people to ignore the ones that matter.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TokenLeaf {
  $value?: string | number;
}

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Flattens `{a:{b:{$value}}}` into `[["a-b", value]]`, skipping `$meta` keys. */
function flatten(node: unknown, prefix: string[] = []): Array<[string, string]> {
  if (typeof node !== 'object' || node === null) return [];

  const leaf = node as TokenLeaf;
  if (leaf.$value !== undefined) {
    return [[prefix.map(kebab).join('-'), String(leaf.$value)]];
  }

  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    out.push(...flatten(v, [...prefix, k]));
  }
  return out;
}

/**
 * Only these groups become Tailwind theme namespaces. `effect`, `motion`,
 * `layout` and `theme` are consumed by hand-written CSS instead — turning them
 * into utilities would generate hundreds of classes nobody uses and bloat every
 * page's CSS for no benefit.
 */
const NAMESPACES: ReadonlyArray<{ group: string; prefix: string }> = [
  { group: 'color', prefix: '--color' },
  { group: 'radius', prefix: '--radius' },
];

export function generateTheme(repoRoot: string): string {
  const tokens = JSON.parse(
    readFileSync(resolve(repoRoot, 'ssot/07-design/tokens.json'), 'utf8'),
  ) as Record<string, unknown>;

  const lines: string[] = [];
  lines.push(`/*`);
  lines.push(` * GENERATED FROM ssot/07-design/tokens.json — do not edit by hand.`);
  lines.push(` * Regenerate with \`pnpm ssot:sync\`. CI fails on drift (ADR-019, ADR-020).`);
  lines.push(` *`);
  lines.push(` * Contrast is verified by \`pnpm contrast:check\`, which computes real WCAG`);
  lines.push(` * ratios. Three tokens are FORBIDDEN as body text: text.dim, brand.orangeDim,`);
  lines.push(` * and semantic.hostile at body size.`);
  lines.push(` */`);
  lines.push('');
  lines.push('@theme {');

  for (const { group, prefix } of NAMESPACES) {
    const entries = flatten(tokens[group]);
    if (entries.length === 0) continue;
    lines.push(`  /* ${group} */`);
    for (const [name, value] of entries) lines.push(`  ${prefix}-${name}: ${value};`);
    lines.push('');
  }

  // Font families live under typography.family in the token file but must be
  // emitted as Tailwind's `--font-*` namespace to produce `font-display` etc.
  const families = flatten((tokens['typography'] as Record<string, unknown>)?.['family']);
  if (families.length > 0) {
    lines.push('  /* typography.family */');
    for (const [name, value] of families) lines.push(`  --font-${name}: ${value};`);
    lines.push('');
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}
