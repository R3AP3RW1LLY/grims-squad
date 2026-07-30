import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A client component may not import VALUES from the `@grims/shared` barrel.
 *
 * ★ WHY THIS TEST EXISTS ★
 *
 * `@grims/shared`'s index re-exports `nonce.service`, which imports `node:crypto`. A server
 * component can import from the barrel freely — and every type-only import is erased before it
 * reaches a bundler, so those are fine anywhere.
 *
 * A CLIENT component importing a runtime value is different: webpack follows the barrel, reaches
 * `node:crypto`, and fails with `UnhandledSchemeError`. The signature editor did exactly this and
 * took down `/forum`, `/app` and every other hub page with a 500 — a bad import in one settings
 * tab, surfacing everywhere except the file that caused it.
 *
 * That distance between cause and symptom is the reason for a test rather than a code review note.
 * The fix is a subpath export (`@grims/shared/forum-signature`), which pulls one module instead of
 * the whole package.
 *
 * ★ WHAT IT DELIBERATELY ALLOWS ★
 *
 * `import type { X } from '@grims/shared'` — erased at compile time, so it cannot reach a bundler.
 * Flagging it would push people towards `import { type X }`, which is not better and would make
 * the rule feel arbitrary.
 */

const SRC = join(process.cwd(), 'src');

/** Every `.ts`/`.tsx` under src, without pulling in a glob dependency. */
function sources(): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: SRC })
    .filter((p) => !p.endsWith('.spec.ts') && !p.endsWith('.spec.tsx'))
    .map((p) => join(SRC, p));
}

describe('client components and the shared barrel', () => {
  it('MANDATORY: no client component imports runtime values from @grims/shared', () => {
    const offenders: string[] = [];

    for (const file of sources()) {
      const src = readFileSync(file, 'utf8');
      // `'use client'` must be the first statement, so a simple presence check is enough.
      if (!/^\s*['"]use client['"]/m.test(src)) continue;

      /*
       * Matches an import FROM the bare package only — `@grims/shared/forum-signature` and
       * `@grims/shared/server` are subpaths and are exactly the fix, so they must not be flagged.
       */
      /*
       * `[^;]*?` scopes the clause to ONE statement. `[\s\S]*?` was tried first and matched from
       * the FIRST import in the file all the way to this one, so every file with any import above
       * a shared import was reported — the guard flagged five innocent files and would have been
       * deleted as noise. An import clause cannot contain a semicolon, so this cannot over-reach.
       */
      const imports = src.matchAll(/import\s+([^;]*?)\s+from\s+['"]@grims\/shared['"]/g);

      for (const match of imports) {
        const clause = match[1] ?? '';
        // `import type { … }` — the whole clause is erased. Allowed.
        if (/^type\s/.test(clause.trim())) continue;

        /*
         * A braced clause where EVERY specifier is `type X` is also fully erased. Checked rather
         * than assumed, because `{ type A, B }` imports a value and looks almost identical.
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
      'These client components pull the @grims/shared barrel into the browser bundle, which ' +
        'reaches node:crypto and fails the build with UnhandledSchemeError — surfacing as a 500 ' +
        'on every hub page, not just this one. Import from a subpath instead ' +
        '(e.g. @grims/shared/forum-signature), or make the import type-only:\n' +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });
});
