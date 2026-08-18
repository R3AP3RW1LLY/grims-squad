import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The website's colonisation board and the app's are fed the same facts.
 *
 * ★ THE CLAIM WAS IN A COMMENT, AND IT WAS NOT TRUE — AUDIT, 2026-08-18 ★
 *
 * colony.controller.ts says, above its board route:
 *
 *   "Both surfaces then call the SAME `rankOpportunities` out of @grims/shared, so the website and
 *    the app cannot put a different build at the top of the same member's list"
 *
 * They did call the same ranker. They were not given the same input. The device route never sent
 * `you`, so every distance on the app's boards was unknown, the "Nearest" sort could order nothing,
 * and members whose position the hub had known all along were told "we do not know where you are
 * yet".
 *
 * Nothing failed. Both surfaces typechecked, both had passing tests, and the ranker did exactly
 * what it was asked with the data it was given.
 *
 * ★ WHY A SOURCE SCAN ★
 *
 * The two routes live on different controllers with different authentication — one takes a session
 * cookie, the other a device token — so there is no single call that exercises both. What can be
 * got wrong is that one route grows a field and the other does not, and reading for that is both
 * cheaper and closer to the mistake than standing up two servers.
 */

const read = (name: string): string =>
  readFileSync(join(process.cwd(), 'src', 'logistics', name), 'utf8');

const WEB = read('colony.controller.ts');
const DEVICE = read('colony-device.controller.ts');

describe('the two colonisation boards are fed the same facts', () => {
  it('found both board routes, so this file cannot pass by matching nothing', () => {
    // A guard on the guard: if either route is renamed, fail loudly rather than quietly protect
    // nothing — the way three assertions in this repo have already gone silent.
    expect(WEB).toContain('projects: await this.colony.board(');
    expect(DEVICE).toContain('projects: await this.colony.board(');
  });

  it('★ MANDATORY: both send the caller position the shared ranker needs ★', () => {
    /*
     * `rankOpportunities` weighs distance from where the member actually is. A surface that sends
     * no position is not ranking differently — it is not ranking at all, and it says so in words
     * the member reads as the app being broken.
     */
    for (const [name, src] of [
      ['the website', WEB],
      ['the companion', DEVICE],
    ] as const) {
      expect(src, `${name} must resolve the caller's last known position`).toContain(
        'this.position.lastKnown(',
      );
      expect(src, `${name} must send it on the board response`).toMatch(/\byou:\s/);
    }
  });

  it('★ MANDATORY: neither lets a position lookup take the board down ★', () => {
    /*
     * A board with no distances is worth far more than no board. Both routes swallow the failure
     * rather than letting one member's missing position 500 the whole page.
     */
    for (const [name, src] of [
      ['the website', WEB],
      ['the companion', DEVICE],
    ] as const) {
      const call = src.slice(src.indexOf('this.position.lastKnown('));
      expect(call.slice(0, 120), `${name} must fail soft`).toContain('.catch(');
    }
  });

  it('sends the same shape, so the shared ranker reads the same fields', () => {
    // Not "a position" — THESE fields. `rankOpportunities` reads coords, and the surfaces show
    // `at` and `source` so a member can tell a fresh fix from a fortnight-old one.
    for (const src of [WEB, DEVICE]) {
      const shape = src.slice(src.indexOf('you:'), src.indexOf('you:') + 260);
      for (const field of ['systemName', 'coords', 'at', 'source']) {
        expect(shape).toContain(field);
      }
    }
  });
});
