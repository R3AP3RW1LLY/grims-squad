import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Who may see a plan.
 *
 * ★ SQUADRON OWNER, 2026-08-24 ★
 *
 * "we want to add a feature that allows users to make their plans available for the entire squadron
 * to view without it being a squadron plan etc." Asked what others may then do with one, the ruling
 * was: read-only, but haulable.
 *
 * ★ WHY THIS FILE EXISTS AT ALL ★
 *
 * The failure mode of a visibility change is not a crash. It is a plan becoming readable by somebody
 * its author never chose, which looks exactly like the feature working and is discovered by the
 * wrong person. There is no error, no log line, and no way to un-see it afterwards.
 *
 * So every read path is pinned here rather than audited once, and the two rules most easily lost —
 * that sharing does not confer editing, and that only the author may share — are pinned hardest.
 */

const HERE = join(process.cwd(), 'src', 'logistics');
const read = (file: string): string => readFileSync(join(HERE, file), 'utf8');

const SERVICE = 'colony-plan.service.ts';
const WEB = 'colony.controller.ts';
const DEVICE = 'colony-device.controller.ts';

/** One method's body, bounded on the next member at class indent. */
function methodBody(source: string, name: string): string {
  const start = source.indexOf(name);
  if (start === -1) return '';
  const rest = source.slice(start + name.length);
  const end = rest.search(/\n {2}(?:async |#|\/\*\*)/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('who may see a plan', () => {
  it('★ MANDATORY: EVERY read path gates the same three ways ★', () => {
    /*
     * The board and the detail. A plan visible on the list and refused when opened would be the
     * worst of both — and two predicates that must agree are two predicates that will eventually
     * not, which is why this counts them rather than trusting a reading.
     *
     * ★ A THIRD PATH ARRIVED ON 2026-08-25, AND THIS TEST IS WHY IT IS GATED ★
     *
     * `predictedTradeFor` reads plans on behalf of the NEXUS: a member groups several systems and
     * asks what they can feed each other. The systems in a group are named by the member, so a
     * group can perfectly well name a system whose only plan belongs to somebody else and is
     * private — and reading it would leak that member's plan through a group they do not know
     * exists.
     *
     * The count going 2 → 3 is the whole value of this test. It failed the moment the method was
     * written, which is precisely when the question needed asking.
     */
    const service = read(SERVICE);

    const gates = service.match(/OR p\.visibility = 'squadron'/g) ?? [];
    expect(gates.length, 'the list, the detail, and the nexus').toBe(3);

    const ownGates = service.match(/OR p\.posted_by_id = \$2::uuid/g) ?? [];
    expect(ownGates.length, 'and each still lets the author see their own').toBe(3);
  });

  it('★ MANDATORY: sharing does NOT confer editing ★', () => {
    /*
     * The rule most easily lost, and the most damaging to lose: a shared plan is READ-ONLY. If
     * `mayEdit` learned about visibility, every member could rewrite somebody's shared plan — and
     * the author would find their work changed with no idea how.
     *
     * `owner` decides editing. `visibility` decides seeing. This test exists to keep those apart.
     */
    const mayEdit = methodBody(read(SERVICE), 'async mayEdit(planId');

    expect(mayEdit.length, 'the method was found').toBeGreaterThan(0);
    expect(mayEdit, 'editing never consults visibility').not.toMatch(/visibility/i);
    expect(mayEdit, 'it is still ownership and rank').toMatch(/COLONY_MANAGE|posted_by_id/);
  });

  it('★ MANDATORY: only the AUTHOR may share ★', () => {
    /*
     * Not officers, and deliberately not for symmetry with editing. Sharing is a decision about
     * somebody's own unfinished work; an officer able to publish a member's private plan could
     * expose something half-thought-through, and there is no un-seeing it.
     */
    const setter = methodBody(read(SERVICE), 'async setVisibility(');

    expect(setter.length, 'the method was found').toBeGreaterThan(0);
    expect(setter).toMatch(/plan\.posted_by_id !== input\.callerId/);
    expect(setter, 'rank is not a way in').not.toMatch(/COLONY_MANAGE/);
  });

  it('★ MANDATORY: a squadron plan is refused, not silently ignored ★', () => {
    /*
     * The column means nothing on a plan every member already sees. A control that appears to work
     * and changes nothing is worse than one that says why it cannot.
     */
    const setter = methodBody(read(SERVICE), 'async setVisibility(');

    expect(setter).toMatch(/plan\.owner === 'squadron'/);
    expect(setter).toMatch(/already visible to every member/);
  });

  it('does not distinguish a plan that is not yours from one that is not there', () => {
    // The rule every other route on this service follows: a caller learns only that they cannot
    // have it, never whether it exists.
    const setter = methodBody(read(SERVICE), 'async setVisibility(');

    expect(setter).toMatch(/plan === undefined \|\| plan\.posted_by_id !== input\.callerId/);
    expect(setter).toMatch(/RESOURCE_NOT_VISIBLE/);
  });

  it('★ MANDATORY: nothing becomes visible because a migration ran ★', () => {
    /*
     * Existing plans were written when private was the only option. Defaulting the column to
     * anything else would publish work retroactively, on somebody else's decision.
     */
    const migration = readFileSync(
      join(process.cwd(), '..', '..', 'packages', 'db', 'prisma', 'migrations',
        '20260824233000_plan_visibility', 'migration.sql'),
      'utf8',
    );

    expect(migration).toMatch(/DEFAULT 'private'/);
    expect(migration, 'and nothing is backfilled to squadron').not.toMatch(/UPDATE\s+"?colony_plans"?/i);
  });

  it('★ MANDATORY: public is never offered for a plan ★', () => {
    /*
     * The enum permits it, because colony_projects uses it for share links. The ruling here was
     * squadron-visible — a plan on a public link is a different feature nobody asked for, and an
     * enum permitting something is not a reason for a service to.
     */
    const setter = methodBody(read(SERVICE), 'async setVisibility(');

    expect(setter).toMatch(/input\.shared \? 'squadron' : 'private'/);
    expect(setter, 'public appears nowhere').not.toMatch(/'public'/);
  });

  it('both surfaces share through the same service', () => {
    for (const file of [WEB, DEVICE]) {
      const source = read(file);
      expect(source, `${file} has the route`).toMatch(/@Patch\('plans\/:id\/visibility'\)/);
      expect(source, `${file} delegates`).toMatch(
        /this\.plans_\.setVisibility\(\{ planId: id, callerId: me\.userId, shared: body\.shared === true \}\)/,
      );
    }
  });
});
