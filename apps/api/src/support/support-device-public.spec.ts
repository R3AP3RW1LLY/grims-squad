import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every route the companion app reaches must be `@Public()` — the colony door's rule, applied
 * to the support door.
 *
 * ★ THE BUG THIS EXISTS FOR IS ALREADY ON THE RECORD ★
 *
 * See device-routes-public.spec.ts: a route inserted between `@Public()` and its method left
 * the board judged by the session guard, and a correctly paired app read it as "this device is
 * no longer paired". That spec is deliberately scoped to ONE file, so a new device controller
 * does not inherit its watch — this is the same watch, pointed here, written the day the
 * controller was.
 *
 * `@Public()` on this controller is not a hole: it only exempts a route from the SESSION guard,
 * which wants a cookie the app has never had. Every method then demands a paired device token,
 * and every console method demands SUPPORT_AGENT on the member behind it — which
 * support-console-gate.spec.ts asserts per route.
 */

const REPO = join(process.cwd(), '..', '..');
const FILE = 'apps/api/src/support/support-device.controller.ts';

const source = readFileSync(join(REPO, FILE), 'utf8');

const METHOD = /@(Get|Post|Patch|Put|Delete)\(/;

/** Every route in the file, with its decorator adjacency — the device-routes-public walk. */
function routes(): Array<{ line: number; verb: string; path: string; publicCount: number }> {
  const lines = source.split('\n');
  const out: Array<{ line: number; verb: string; path: string; publicCount: number }> = [];

  for (const [i, text] of lines.entries()) {
    const m = METHOD.exec(text);
    if (m === null) continue;

    const path = /\((?:'([^']*)'|")/.exec(text)?.[1] ?? '';

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

describe('the companion app can reach every support route meant for it', () => {
  const all = routes();

  it('found the routes at all', () => {
    // A guard on the guard: a parse that matched nothing would pass everything below.
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(all.map((r) => r.path)).toContain('conversations');
  });

  it('marks every one @Public(), including the access hint', () => {
    const naked = all.filter((r) => r.publicCount === 0);

    expect(
      naked.map((r) => `${r.verb} ${r.path} (${FILE}:${r.line})`),
      'these routes are judged by the session guard, so a device token cannot reach them',
    ).toEqual([]);
  });

  it('marks none of them twice', () => {
    // A doubled decorator is the fingerprint of the original bug: one route ends up with two
    // because the route below it was left with none.
    const doubled = all.filter((r) => r.publicCount > 1);

    expect(
      doubled.map((r) => `${r.verb} ${r.path} (${FILE}:${r.line}) has ${r.publicCount}`),
      'a doubled @Public() usually means the route below it lost one',
    ).toEqual([]);
  });
});
