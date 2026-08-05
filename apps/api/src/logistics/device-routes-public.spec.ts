import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every route the companion app reaches must be `@Public()`.
 *
 * ★ THE BUG THIS EXISTS FOR — REPORTED 2026-08-04 ★
 *
 * "I still get: This device is no longer paired", and "the one member colonisation project that
 * appears on the website no longer appears in the companion app".
 *
 * Both were one missing decorator. `@Public()` sat directly above `projects()` and its doc comment;
 * the build catalogue routes were later inserted between them, so the decorator bound to
 * `build-types` — which ended up with TWO — and `projects` was left with none.
 *
 * ★ WHY `@Public()` IS NOT A HOLE HERE ★
 *
 * It reads like "no authentication", and on this controller it means the opposite. It only exempts
 * the route from the SESSION guard, which looks for a cookie the companion app has never had and
 * will never have. Every method then calls `#caller()`, which demands a paired device token AND the
 * permission bit. A route missing it is not more secure — it is unreachable by the only client that
 * exists, and it fails as a 401 that reads to a member as "your device was unpaired".
 *
 * ★ WHY THIS IS SOURCE TEXT AND NOT A REQUEST ★
 *
 * Booting Nest to enumerate route metadata drags Prisma and a database into a check about one
 * decorator. Nothing about the omission is visible to the compiler: the file typechecks, lints, and
 * the route works perfectly from a browser. Reading the file is what catches it, and it is what
 * would have caught it the day it happened.
 *
 * ★ WHY THIS RULE IS SCOPED TO ONE FILE AND NOT APPLIED EVERYWHERE ★
 *
 * The other two controllers a device touches were audited when this was written, and neither can
 * take the same blanket rule:
 *
 *   - `telemetry/telemetry.controller.ts` MIXES the two. Its device routes — links, poll, settings,
 *     journal — are `@Public()`; its `me/devices` and `me/telemetry-consent` routes are the
 *     website's and must stay behind the session guard. "All of them" would be wrong there, and
 *     a rule that has to list exceptions is a rule that gets edited rather than obeyed.
 *   - `companion/companion.controller.ts` is not a device surface at all. Its routes take `@User()`
 *     and are called by the WEBSITE to decide whether to announce a release; nothing in
 *     `apps/companion/src` calls them.
 *
 * This controller is the one place where every single route exists for the app, which is exactly
 * what makes an exceptionless rule enforceable here.
 */

const REPO = join(process.cwd(), '..', '..');
const FILE = 'apps/api/src/logistics/colony-device.controller.ts';

const source = readFileSync(join(REPO, FILE), 'utf8');

const METHOD = /@(Get|Post|Patch|Put|Delete)\(/;

/**
 * Every route in the file, with whatever decorators sit above it.
 *
 * Walked line by line rather than matched with one regex: the thing being tested is an ADJACENCY —
 * which decorator is nearest which route — and a regex spanning comments is exactly the reasoning
 * that produced the bug.
 */
function routes(): Array<{ line: number; verb: string; path: string; publicCount: number }> {
  const lines = source.split('\n');
  const out: Array<{ line: number; verb: string; path: string; publicCount: number }> = [];

  for (const [i, text] of lines.entries()) {
    const m = METHOD.exec(text);
    if (m === null) continue;

    const path = /\((?:'([^']*)'|")/.exec(text)?.[1] ?? '';

    /*
     * Walk back over the decorator block. Comments and blank lines are skipped — they are allowed
     * between a decorator and its route — but anything else ends the block, which is what makes
     * this notice a decorator that belongs to a DIFFERENT route further up.
     */
    let publicCount = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const above = (lines[j] ?? '').trim();
      if (above === '' || above.startsWith('*') || above.startsWith('/*') || above.startsWith('//'))
        continue;
      if (above.startsWith('*/')) continue;
      if (above.startsWith('@Public()')) {
        publicCount += 1;
        continue;
      }
      if (above.startsWith('@')) continue;
      break;
    }

    out.push({ line: i + 1, verb: m[1] as string, path, publicCount });
  }

  return out;
}

describe('the companion app can reach every route meant for it', () => {
  const all = routes();

  it('found the routes at all', () => {
    // A guard on the guard. A parse that matched nothing would pass every assertion below while
    // watching nothing — which is the failure mode of every source-text test.
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all.map((r) => r.path)).toContain('projects');
  });

  it('marks every one @Public(), including the board', () => {
    const naked = all.filter((r) => r.publicCount === 0);

    expect(
      naked.map((r) => `${r.verb} ${r.path} (${FILE}:${r.line})`),
      'these routes are judged by the session guard, so a device token cannot reach them',
    ).toEqual([]);
  });

  it('marks none of them twice', () => {
    /*
     * A doubled decorator is harmless on its own and is the FINGERPRINT of the bug: one route ends
     * up with two because the route below it was left with none. Catching the duplicate catches the
     * cause rather than the symptom.
     */
    const doubled = all.filter((r) => r.publicCount > 1);

    expect(
      doubled.map((r) => `${r.verb} ${r.path} (${FILE}:${r.line}) has ${r.publicCount}`),
      'a doubled @Public() usually means the route below it lost one',
    ).toEqual([]);
  });
});
