import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A search that did not finish must say so on BOTH surfaces.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "the scouting system in the colonization module is now no longer finding anything or returning any
 * results!"
 *
 * It was finding things. The galaxy sweep was intermittently timing out, and a timed-out sweep
 * returned the same empty list an empty region returns. The website said "Nothing claimable in
 * range"; the app said "Everything nearby is already colonised, inhabited or permit-locked" — a
 * flat statement about a region it had not managed to look at.
 *
 * ★ WHY A SOURCE-TEXT TEST ★
 *
 * Same reasoning as the colonisation menu and the orphan flags next door. The two screens are a
 * React server component and a Preact component, in different packages and different runtimes, with
 * nothing linking them. Nothing can notice when one grows a warning and the other does not, and this
 * is now the third thing to drift between these two surfaces.
 *
 * The WORDING is not duplicated — both call `sweepNotice` in @grims/shared, so the text cannot
 * disagree. What these guard is that each surface still asks.
 */

/*
 * From the working directory rather than `import.meta.dirname`: this package's spec tsconfig emits
 * CommonJS, where `import.meta` is a compile error. Vitest sets the cwd to the package, and the
 * readFileSync below proves the path on every run.
 */
const REPO = join(process.cwd(), '..', '..');

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

const WEB_PAGE = 'apps/web/src/app/(hub)/colonisation/scout/page.tsx';
const APP_PAGE = 'apps/companion/src/renderer/scout.tsx';
const SHARED = 'packages/shared/src/colony-scout.ts';

describe('an unfinished search is reported on both surfaces', () => {
  it('★ MANDATORY: both ask whether the sweep finished ★', () => {
    for (const [what, rel] of [
      ['website', WEB_PAGE],
      ['app', APP_PAGE],
    ] as const) {
      const src = read(rel);

      // A guard on the guard: a moved file would read empty and pass everything below in silence.
      expect(src.length, `${what} scout page is readable`).toBeGreaterThan(500);

      expect(src, `${what} asks the shared helper`).toContain('sweepNotice');
      expect(src, `${what} reads the field the hub sends`).toContain('incomplete');
    }
  });

  it('★ MANDATORY: neither claims the region is empty without checking ★', () => {
    /*
     * The heart of the bug. Both surfaces had a confident sentence about the galaxy on the
     * zero-candidates branch, printed whether or not the search had actually run.
     *
     * Each must now reach that sentence only when there is no notice to show instead. Asserting the
     * two appear together is what stops a later edit restoring the unconditional version.
     */
    const web = read(WEB_PAGE);
    expect(web).toContain('Nothing claimable in range');
    expect(
      web.indexOf('notice === null'),
      'the website only says "nothing claimable" when the sweep finished',
    ).toBeGreaterThan(-1);

    const app = read(APP_PAGE);
    expect(app).toContain('Nothing claimable inside that range');
    expect(
      app,
      'the app falls back to its flat sentence only when there is no notice',
    ).toMatch(/\{notice \?\?/);
  });

  it('the wording lives in one place, so the two cannot disagree', () => {
    /*
     * If either surface ever inlines its own sentence, the mirror is broken even though both still
     * "show a warning" — which is the failure mode that is hardest to see in review.
     */
    const shared = read(SHARED);
    expect(shared).toContain('export function sweepNotice');

    for (const [what, rel] of [
      ['website', WEB_PAGE],
      ['app', APP_PAGE],
    ] as const) {
      expect(
        read(rel),
        `${what} must not hand-write the galaxy-service sentence`,
      ).not.toMatch(/galaxy service (did not|stopped) answer/i);
    }
  });
});
