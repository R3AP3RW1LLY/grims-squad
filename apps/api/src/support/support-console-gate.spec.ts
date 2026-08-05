import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every officer route is behind SUPPORT_AGENT — source text, like the device-public spec.
 *
 * ★ WHY THE GATE IS WORTH A SPEC OF ITS OWN ★
 *
 * The console reads members' and guests' PRIVATE conversations. Its gate is one class-level
 * decorator, which is exactly the kind of line a refactor moves, and nothing about losing it is
 * visible to the compiler: the file typechecks, the routes work, and every signed-in member can
 * suddenly read the help desk. Reading the file is what catches it.
 *
 * The device door has no class guard to lean on — the session guard cannot judge a device —
 * so there the gate is `#agent()` in every method body, and that is asserted per route.
 */

const REPO = join(process.cwd(), '..', '..');

const CONSOLE = 'apps/api/src/support/support-console.controller.ts';
const DEVICE = 'apps/api/src/support/support-device.controller.ts';

const METHOD = /@(Get|Post|Patch|Put|Delete)\(/;

/** Route method names with their verb, and the body text up to the next route or end of class. */
function routeBodies(source: string): Array<{ verb: string; path: string; body: string }> {
  const lines = source.split('\n');
  const marks: Array<{ index: number; verb: string; path: string }> = [];

  for (const [i, text] of lines.entries()) {
    const m = METHOD.exec(text);
    if (m === null) continue;
    marks.push({ index: i, verb: m[1] as string, path: /\('([^']*)'/.exec(text)?.[1] ?? '' });
  }

  return marks.map((mark, n) => ({
    verb: mark.verb,
    path: mark.path,
    body: lines.slice(mark.index, marks[n + 1]?.index ?? lines.length).join('\n'),
  }));
}

describe('the website console is gated at the class', () => {
  const source = readFileSync(join(REPO, CONSOLE), 'utf8');

  it('MANDATORY: @RequiresPermission(Permission.SUPPORT_AGENT) sits on the controller', () => {
    /*
     * Adjacency, not mere presence: the decorator must be in the block directly above the class
     * declaration, where it gates every route the class will ever grow. A copy pasted onto one
     * method would satisfy a `contains` check while leaving the others open.
     */
    expect(source).toMatch(
      /@Controller\('v1\/support\/console'\)\s*\n@RequiresPermission\(Permission\.SUPPORT_AGENT\)\s*\nexport class SupportConsoleController/,
    );
  });

  it('holds exactly one controller class, so the class gate covers every route in the file', () => {
    expect(source.match(/@Controller\(/g)).toHaveLength(1);
    expect(source.match(/export class /g)).toHaveLength(1);
    // A guard on the guard: the parse found the surface it claims to watch.
    expect(routeBodies(source).length).toBeGreaterThanOrEqual(6);
  });
});

describe('the device console gates every route in its own body', () => {
  const source = readFileSync(join(REPO, DEVICE), 'utf8');
  const routes = routeBodies(source);

  /*
   * The device controller carries TWO doors now: the console routes (SUPPORT_AGENT, via
   * `#agent`) and the `me/` member routes — the website widget's asking side, which any paired
   * member may use. The split below is by path prefix, so a new route lands in exactly one
   * bucket and cannot be forgotten by both assertions.
   */
  const memberRoutes = routes.filter((r) => r.path.startsWith('me/'));
  const consoleRoutes = routes.filter((r) => r.path !== 'access' && !r.path.startsWith('me/'));

  it('found the routes at all', () => {
    expect(consoleRoutes.length).toBeGreaterThanOrEqual(6);
    expect(memberRoutes.length).toBeGreaterThanOrEqual(5);
    expect(routes.map((r) => r.path)).toContain('conversations');
  });

  it('MANDATORY: every console route resolves the caller through #agent', () => {
    const naked = consoleRoutes.filter((r) => !r.body.includes('this.#agent(req)'));

    expect(
      naked.map((r) => `${r.verb} ${r.path}`),
      'these device routes would answer without checking SUPPORT_AGENT',
    ).toEqual([]);
  });

  it('MANDATORY: every member route authenticates the device — and never demands SUPPORT_AGENT', () => {
    /*
     * Both halves matter. A member route that lost `#device` would answer strangers; one that
     * gained `#agent` would lock every ordinary member out of their own help chat, which is the
     * inverse bug and just as silent.
     */
    const unauthenticated = memberRoutes.filter((r) => !r.body.includes('this.#device(req)'));
    const overGated = memberRoutes.filter((r) => r.body.includes('this.#agent(req)'));

    expect(
      unauthenticated.map((r) => `${r.verb} ${r.path}`),
      'these member routes would answer without a paired device',
    ).toEqual([]);
    expect(
      overGated.map((r) => `${r.verb} ${r.path}`),
      'these member routes would demand SUPPORT_AGENT from members asking for help',
    ).toEqual([]);
  });

  it('MANDATORY: member routes reach only the member half of the service', () => {
    /*
     * The console methods take no "whose" — consoleRead(id) answers ANY conversation, because
     * its callers have already proven SUPPORT_AGENT. A member route calling one would be an
     * any-member read of the whole help desk. The member methods scope every query to the
     * caller, so these are the only ones the `me/` door may touch.
     */
    const forbidden = /this\.support\.(console|replyAsOfficer|transition)/;
    const leaking = memberRoutes.filter((r) => forbidden.test(r.body));

    expect(
      leaking.map((r) => `${r.verb} ${r.path}`),
      'these member routes reach console methods that are scoped to no owner',
    ).toEqual([]);
  });

  it('the access hint still authenticates the DEVICE before answering', () => {
    /*
     * `access` deliberately does not throw on a missing permission — it is how the sidebar
     * decides whether to draw the entry — but it must still refuse an unpaired caller, or it
     * becomes an unauthenticated probe.
     */
    const access = routes.find((r) => r.path === 'access');
    expect(access?.body).toContain('this.#device(req)');
  });
});
