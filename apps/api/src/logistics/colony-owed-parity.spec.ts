import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The combined shopping list, and the two doors onto it.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * "SrvSurvey will then show cargo items needed only for the primary or all projects" — under the
 * standing rule, "we need all of this in full parity on the website and the companion app".
 *
 * ★ WHAT THIS GUARDS IS THE SHARED MERGE, NOT THE ROUTES ★
 *
 * Two endpoints answering the same question is exactly how the two surfaces drift: the day somebody
 * changes the ordering or the case-matching on one of them, a member planning a buying run on the
 * site and flying it with the app gets two different lists and no way to tell which is right.
 *
 * So both doors are required to call `mergeNeeds` and `everythingOwed` and do nothing else with the
 * rows. The merge itself is tested properly in `colony-all-needs.spec.ts`.
 */

const HERE = join(process.cwd(), 'src', 'logistics');
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

const WEB = 'colony.controller.ts';
const DEVICE = 'colony-device.controller.ts';

describe('everything a member owes', () => {
  it('★ MANDATORY: both surfaces merge with the SAME shared rule ★', () => {
    for (const file of [WEB, DEVICE]) {
      const source = read(file);

      // Anchored to a live line: an assertion on the bare string matches an import that has been
      // commented out just as happily, which has caught this project out five times.
      expect(source, `${file} imports the shared merge`).toMatch(
        /^import \{ mergeNeeds \} from '@grims\/shared\/colony-all-needs';/m,
      );
      expect(source, `${file} actually calls it`).toMatch(
        /^\s*return mergeNeeds\(await this\.colony\.everythingOwed\(me\.userId\)\);/m,
      );
    }
  });

  it('★ MANDATORY: neither door widens the scope past the caller ★', () => {
    /*
     * `everythingOwed` is scoped by membership — you cannot join a build you cannot see — and the
     * caller id is what enforces it. A route passing anything but its own resolved session would
     * hand one member another member's build list.
     */
    for (const file of [WEB, DEVICE]) {
      expect(read(file)).not.toMatch(/everythingOwed\((?!me\.userId\))/);
    }
  });

  it('the website route requires a session, like every other member read', () => {
    const source = read(WEB);
    const route = source.indexOf("@Get('owed')");
    expect(route, 'the route exists').toBeGreaterThan(-1);

    // The permission check sits between the route and its merge call.
    const body = source.slice(route, route + 600);
    expect(body).toMatch(/#requireSession\(caller\)/);
    expect(body).toMatch(/Permission\.COLONY_VIEW/);
  });

  it('the device route is paired and asks the same permission', () => {
    const source = read(DEVICE);
    const route = source.indexOf("@Get('current/all')");
    expect(route, 'the route exists').toBeGreaterThan(-1);

    const body = source.slice(route, route + 600);
    /*
     * `@Public()` on this controller means "no website session cookie", not "no authentication" —
     * `#caller` resolves the device token and checks the permission. Same bar as the website's door,
     * which is the point: saying what you owe is not a privilege on one surface and not the other.
     */
    expect(body).toMatch(/Permission\.COLONY_VIEW/);
    expect(body).toMatch(/this\.#caller\(/);
  });
});
