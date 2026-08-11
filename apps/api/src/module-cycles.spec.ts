import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * No module imports itself, however long the way round.
 *
 * ★ A PRODUCTION OUTAGE, AND EVERY TEST WAS GREEN — 2026-08-10 ★
 *
 * A plan-review feature added `AiModule` to `LogisticsModule`'s imports. That closed a cycle:
 *
 *     LogisticsModule -> AiModule -> MiningModule -> LogisticsModule
 *
 * Node evaluates that as `ReferenceError: Cannot access 'LogisticsModule' before initialization`.
 * The API crash-looped on boot; the website kept serving its static pages perfectly, so "is the site
 * up" said yes while everything behind it was dead, and the health monitor reported it a minute
 * later.
 *
 * Typecheck passed. Lint passed. Every unit test in seventeen packages passed. `controller-
 * injection.spec.ts` passed too — every constructor named its token correctly. The fault was not in
 * any file, it was in the shape of the graph between them.
 *
 * ★ AND THE OBVIOUS TEST DOES NOT WORK — CHECKED, NOT ASSUMED ★
 *
 * The first attempt at this simply imported the root module and asserted it did not throw. It
 * passed. Then it passed WITH THE EXACT CYCLE PUT BACK, because vitest transforms modules through
 * esbuild and tolerates a circular evaluation that real ESM refuses. A test that cannot fail on the
 * bug it was written for is worse than no test: it is a claim of safety.
 *
 * The same trap as `design:paramtypes` under vitest, and found the same way — by reintroducing the
 * fault and watching the suite stay green.
 *
 * ★ SO THIS READS THE GRAPH INSTEAD OF RUNNING IT ★
 *
 * A source scan of every `*.module.ts` and the module files it imports, and a depth-first search
 * for a path from a module back to itself. No runtime, no bundler, no environment to differ from
 * production — the cycle is a property of the text, and the text is what ships.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function moduleFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) moduleFiles(full, found);
    else if (entry.endsWith('.module.ts')) found.push(full);
  }
  return found;
}

/** Which other module files each module imports, resolved to absolute paths. */
function graph(): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const file of moduleFiles(HERE)) {
    const src = readFileSync(file, 'utf8');
    const edges: string[] = [];

    for (const m of src.matchAll(/^import\s+(?:type\s+)?[^;]*?from\s+'(\.[^']*\.module\.js)'/gm)) {
      /*
       * `import type` is excluded above: a type-only import is erased before the code runs and
       * cannot participate in an evaluation cycle. Counting it would report cycles that do not
       * exist, and a guard that cries wolf is one somebody disables.
       */
      const target = resolve(dirname(file), (m[1] ?? '').replace(/\.js$/, '.ts'));
      edges.push(target);
    }

    out.set(file, edges);
  }

  return out;
}

/** Every cycle, as a readable path. Depth-first, reporting the first loop found from each start. */
function cycles(g: Map<string, string[]>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const walk = (node: string, path: string[]): void => {
    const at = path.indexOf(node);
    if (at !== -1) {
      const loop = [...path.slice(at), node].map((f) => relative(HERE, f).replace(/\\/g, '/'));
      const key = [...loop].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        found.push(loop.join(' -> '));
      }
      return;
    }
    // A node already fully explored on another branch cannot start a new cycle through this path.
    if (path.length > 24) return;

    for (const next of g.get(node) ?? []) walk(next, [...path, node]);
  };

  for (const start of g.keys()) walk(start, []);
  return found;
}

describe('the module graph has no cycles', () => {
  const g = graph();

  it('★ MANDATORY: no module imports itself, however long the way round ★', () => {
    /*
     * This is the assertion that would have stopped the outage. Reintroducing
     * `imports: [..., AiModule]` on LogisticsModule makes it print:
     *
     *   logistics/logistics.module.ts -> ai/ai.module.ts -> mining/mining.module.ts
     *     -> logistics/logistics.module.ts
     *
     * The fix is never to reorder imports. It is to break the cycle — usually by constructing the
     * shared thing where it is needed rather than importing the module that provides it. `AiClient`
     * is a plain class over fetch; `LogisticsModule` builds one itself.
     */
    expect(
      cycles(g),
      'a module import cycle crash-loops the API on boot with "Cannot access X before ' +
        'initialization", while the website keeps serving static pages and every unit test stays green',
    ).toEqual([]);
  });

  it('★ MANDATORY: the scan actually found the modules — a silent zero passes everything ★', () => {
    /*
     * The failure mode that makes a source scan worthless: the pattern stops matching, the graph is
     * empty, and "no cycles" is reported about nothing for ever. There were 20-odd modules the day
     * this was written; the floor is well under that and far above zero.
     */
    expect(g.size, 'no module files found — the scan has stopped working').toBeGreaterThan(10);
    expect(
      [...g.values()].reduce((n, e) => n + e.length, 0),
      'no module-to-module imports found — the import pattern has stopped matching',
    ).toBeGreaterThan(5);
  });
});
