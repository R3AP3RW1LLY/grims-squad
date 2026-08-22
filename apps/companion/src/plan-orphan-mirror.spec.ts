import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A plan that has stopped meaning what it looks like it means must say so on BOTH surfaces.
 *
 * ★ SQUADRON OWNER, 2026-08-03 ★
 *
 * "ensure the Companion app matches and has all the same pages in colonization that the website has
 * please! must be a mirror!"
 *
 * ★ WHY THIS EXISTS AT ALL ★
 *
 * The orphan flags shipped on the website's plan board and not in the app's plan list. Both read the
 * same `/plans` response, which carried the flags the whole time — the app simply never drew them,
 * so an officer who only ever opens the companion would never learn a plan was measuring progress
 * against construction projects that no longer exist.
 *
 * That is not a rendering detail. It is the failure mode this squadron keeps hitting: a feature
 * complete everywhere except where somebody could reach it.
 *
 * ★ WHY IT COMPARES SOURCE TEXT ★
 *
 * Same reasoning as the colonisation menu mirror next door. The two lists are a React server-adjacent
 * component and a Preact component in different packages and different runtimes; nothing links them,
 * so nothing can notice when one grows a warning and the other does not. Standing up a DOM for each
 * to assert on the rendered badge would cost a rendering harness the companion does not otherwise
 * have, and would fail for many reasons other than the one worth failing for.
 */

/*
 * From the working directory rather than `import.meta.dirname` — this package's spec tsconfig emits
 * CommonJS, where `import.meta` is a compile error. Vitest sets the cwd to the package, and the
 * readFileSync below proves the path on every run.
 */
const REPO = join(process.cwd(), '..', '..');

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const WEB_BOARD = 'apps/web/src/app/(hub)/colonisation/planning/plan-board.tsx';
const APP_LIST = 'apps/companion/src/renderer/planning.tsx';

describe('the orphan flags reach both surfaces', () => {
  it('★ MANDATORY: the app draws them, not just the website ★', () => {
    const app = read(APP_LIST);

    // A guard on the guard: if the file is ever moved, an empty read would pass every assertion
    // below and this spec would go quiet while claiming to watch.
    expect(app.length).toBeGreaterThan(1_000);

    expect(app, 'the app reads the flags off the plan').toContain('orphanFlags');
    expect(app, 'and renders the message, not merely the presence of one').toMatch(
      /flag\.message/,
    );
  });

  it('shows ONE finding, the ranked first, on both', () => {
    /*
     * Three conditions can be true at once — a broken plan is always also an old one. The hub ranks
     * them and each surface shows the first. Rendering all three buries the only actual fault under
     * two observations, and the eye lands on the last line.
     *
     * `[0]` on both sides is therefore the assertion: an edit that starts mapping the whole array
     * has changed the feature, not the styling.
     */
    for (const [what, src] of [
      ['website', read(WEB_BOARD)],
      ['app', read(APP_LIST)],
    ] as const) {
      expect(src, `${what} takes the ranked first flag`).toMatch(/orphanFlags\?\.\[0\]/);
      expect(src, `${what} does not map the whole array`).not.toMatch(/orphanFlags\??\.?\s*\.map\(/);
    }
  });

  it('★ MANDATORY: a fault is coloured differently from an observation ★', () => {
    /*
     * `dangling-sites` is the only one of the three that is WRONG — the plan's numbers are being
     * measured against something that is gone. The other two are worth knowing and are not faults.
     *
     * If both render in the same colour the ranking still works but the glance does not, and the
     * glance is what a list is for. Each surface uses its own palette, so this asserts the branch
     * exists rather than the value it produces.
     */
    for (const [what, src] of [
      ['website', read(WEB_BOARD)],
      ['app', read(APP_LIST)],
    ] as const) {
      expect(src, `${what} singles out the fault`).toContain(`'dangling-sites'`);
      expect(src, `${what} branches on it rather than styling all three alike`).toMatch(
        /kind === 'dangling-sites'\s*\?/,
      );
    }
  });
});
