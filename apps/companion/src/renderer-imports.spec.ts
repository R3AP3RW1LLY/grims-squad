import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * A renderer module may not import VALUES from the `@grims/shared` barrel.
 *
 * ★ WHY THIS TEST EXISTS ★
 *
 * The web app has had this rule for months (`apps/web/src/lib/client-imports.spec.ts`). The
 * companion did not, and on 2026-08-07 it cost a red CI build: `renderer/trade.tsx` imported
 * `depthOf` from the barrel, esbuild followed the re-export chain to `nonce.service`, and the
 * renderer bundle failed with
 *
 *   ../../packages/shared/dist/nonce.service.js:1:26: ERROR: Could not resolve "node:crypto"
 *
 * The whole `build` job died on it. Nothing caught it locally because the unit suite never bundles
 * the renderer — only `pnpm build` does, and that is not something run between edits.
 *
 * ★ WHY THE COMPANION NEEDS ITS OWN COPY ★
 *
 * The web guard keys off `'use client'`. The companion has no such marker: its client boundary is
 * the two esbuild entry points in `build.mjs`, bundled with `platform: 'browser'`. Everything
 * reachable from those is browser code and cannot see a node builtin, exactly as in the web app —
 * the boundary is just drawn somewhere else.
 *
 * The MAIN process is unaffected and deliberately unchecked: it runs in Node, so
 * `apps/companion/src/main.ts` importing the barrel is correct and stays that way.
 *
 * ★ WHAT IT DELIBERATELY ALLOWS ★
 *
 * `import type { X } from '@grims/shared'` — erased before esbuild sees it. The renderer pages
 * import their row types from the main-process modules this way on purpose, and flagging that would
 * make the rule feel arbitrary.
 */

const SRC = join(process.cwd(), 'src');

/**
 * The bundler's entry points, taken from `build.mjs` rather than hard-coded.
 *
 * A third overlay added there and not here would leave a hole precisely where nobody would look for
 * one, so the list is read from the file that actually decides it.
 */
function entryPoints(): string[] {
  const build = readFileSync(join(process.cwd(), 'build.mjs'), 'utf8');
  const found = [...build.matchAll(/entryPoints:\s*\['(src\/renderer\/[^']+)'\]/g)]
    .map((m) => m[1])
    .filter((p): p is string => p !== undefined)
    .map((p) => join(process.cwd(), p));

  expect(
    found.length,
    'no renderer entry points found in build.mjs — the pattern this test reads them with has ' +
      'drifted, and the guard is silently checking nothing',
  ).toBeGreaterThan(0);

  return found;
}

/**
 * Every relative import in a file, resolved to a real path.
 *
 * Extensionless, `.js` (TypeScript's ESM convention, which this app uses throughout) and directory
 * `index` forms are all tried, because a specifier this cannot resolve is a module it cannot follow.
 */
function relativeImports(file: string, src: string): string[] {
  const found: string[] = [];

  for (const m of src.matchAll(/from\s+['"](\.[^'"]*)['"]/g)) {
    const spec = m[1];
    if (spec === undefined) continue;

    const base = resolve(dirname(file), spec.replace(/\.js$/, ''));
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ]) {
      if (existsSync(candidate)) {
        found.push(candidate);
        break;
      }
    }
  }

  return found;
}

/** The entry points, and everything reachable from them through relative imports. */
function bundled(): Set<string> {
  const reached = new Set<string>();
  const queue = entryPoints();

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || reached.has(file)) continue;
    if (!existsSync(file)) continue;
    reached.add(file);
    for (const next of relativeImports(file, readFileSync(file, 'utf8'))) {
      if (!reached.has(next)) queue.push(next);
    }
  }

  return reached;
}

describe('the renderer bundle and the shared barrel', () => {
  it('MANDATORY: no renderer module imports runtime values from @grims/shared', () => {
    const offenders: string[] = [];

    for (const file of bundled()) {
      const src = readFileSync(file, 'utf8');

      /*
       * The bare package only. `@grims/shared/market-depth` is a subpath and is exactly the fix, so
       * it must not be flagged.
       *
       * `[^;]*?` scopes the clause to ONE statement — the web copy of this guard tried `[\s\S]*?`
       * first and matched from the first import in the file all the way down to this one, flagging
       * every innocent file with an import above a shared import.
       */
      for (const match of src.matchAll(/import\s+([^;]*?)\s+from\s+['"]@grims\/shared['"]/g)) {
        const clause = match[1] ?? '';
        // `import type { … }` — the whole clause is erased. Allowed.
        if (/^type\s/.test(clause.trim())) continue;

        /*
         * A braced clause where EVERY specifier is `type X` is erased too. Checked rather than
         * assumed, because `{ type A, B }` imports a value and looks almost identical.
         */
        const braced = /^\{([\s\S]*)\}$/.exec(clause.trim());
        if (braced !== null) {
          const specifiers = (braced[1] ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '');
          if (specifiers.length > 0 && specifiers.every((s) => s.startsWith('type '))) continue;
        }

        offenders.push(`${file.slice(SRC.length + 1)} — ${clause.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }

    expect(
      offenders,
      'These modules are bundled for the browser by build.mjs and pull the @grims/shared barrel ' +
        'with them, which reaches node:crypto and fails the whole build with ' +
        '"Could not resolve node:crypto". Import from a subpath instead ' +
        '(e.g. @grims/shared/market-depth), or make the import type-only:\n' +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });
});
