import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A permission denial must never be presented as a two-factor challenge.
 *
 * ★ THE PRODUCTION INCIDENT THIS FILE EXISTS FOR ★
 *
 * 2026-07-30. An officer holding MEMBER_MANAGE but not ROLE_MANAGE opened /app/roles and was
 * shown the authenticator code box. They entered a valid code. The API accepted it —
 * `POST /v1/auth/totp/verify 201`, seven times — and the page returned to the code box every
 * time, because no code can grant a permission.
 *
 * The cause was one line, and a comment asserting something false:
 *
 *     // Null means the API refused — which for these routes is the two-factor gate
 *     if (roles === null) return <StepUp />;
 *
 * `null` came from `get()`, which collapses EVERY failure — 401, a cloaked 404 for a missing
 * permission, a 5xx — into the same value. Three unrelated problems, one screen, and only one
 * of them fixable by the thing that screen asked for.
 *
 * It was reported as "the 2FA has stopped working", which was the only reasonable reading.
 *
 * ★ WHY THIS IS A STRUCTURAL TEST ★
 *
 * The failure was not a wrong computation. It was a MISSING DISTINCTION — and the way it
 * comes back is somebody adding a new admin page and reaching for the old one-liner because
 * it is shorter. So this asserts the shape of the gating code, which is what would actually
 * regress.
 */

const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');

/** Source with comments stripped, so prose about the bug cannot satisfy a check. */
const code = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const ADMIN_PAGES = ['app/(hub)/app/page.tsx', 'app/(hub)/app/roles/page.tsx'];

describe('admin pages distinguish WHY a read was refused', () => {
  it('MANDATORY: no admin page renders StepUp from a bare null check', () => {
    /*
     * The exact shape of the bug: a null test whose only outcome is the 2FA challenge.
     * Matching on the pattern rather than on behaviour because the pattern is what somebody
     * would copy into the next admin page.
     */
    for (const page of ADMIN_PAGES) {
      const src = code(page);

      // `if (<something> === null) return <StepUp />` — the original defect.
      expect(src, `${page} must not map a bare null to StepUp`).not.toMatch(
        /if\s*\([^)]*===\s*null\s*\)\s*return\s*<StepUp\s*\/>/,
      );
    }
  });

  it('MANDATORY: every admin page can render a NON-2FA refusal', () => {
    /*
     * The positive half. A page that cannot express "you do not have this permission" will
     * express it as something else — and the something else it reached for last time was a
     * code box.
     */
    for (const page of ADMIN_PAGES) {
      const src = code(page);
      expect(src, `${page} should be able to show NoAccess`).toContain('NoAccess');
      expect(src, `${page} should be able to show AdminUnavailable`).toContain(
        'AdminUnavailable',
      );
    }
  });

  it('MANDATORY: the gated fetch keys off the API error CODE, not the status number', () => {
    /*
     * A 403 is TWO_FACTOR_REQUIRED for the step-up gate and PERMISSION_DENIED for a missing
     * permission. Those need opposite screens, so branching on `403` alone would reintroduce
     * the conflation one level down.
     */
    const api = code('lib/api.ts');

    expect(api).toContain("'TWO_FACTOR_REQUIRED'");
    expect(api).toContain("'PERMISSION_DENIED'");
    expect(api).toContain("'RESOURCE_NOT_VISIBLE'");
    // And the four outcomes are distinct states rather than a boolean.
    for (const state of ['needs-step-up', 'forbidden', 'signed-out', 'unavailable']) {
      expect(api, `AdminRead should model '${state}'`).toContain(state);
    }
  });

  it('MANDATORY: the cloak is NOT weakened to fix this', () => {
    /*
     * The temptation was to stop cloaking admin permission denials as 404 so the web layer
     * could tell them apart. That would trade a UX bug for an information-disclosure one
     * (INV-024). The API still answers 404; the WEB layer stopped mistaking it for 2FA.
     *
     * Asserted so the easier, wrong fix is a visible change to the API rather than a quiet
     * one.
     */
    const guard = read('../../../apps/api/src/authz/requires-permission.guard.ts');
    expect(guard).toContain('CloakAsNotFound');
  });
});

describe('the NoAccess screen', () => {
  it('MANDATORY: never offers a code box', () => {
    /*
     * The whole point. Anything resembling a code entry on this screen recreates the loop —
     * somebody typing correct codes at a problem codes cannot solve.
     */
    const src = read('app/(hub)/app/no-access.tsx');

    expect(src).not.toContain('one-time-code');
    expect(src).not.toMatch(/<input/);
    expect(src).not.toContain('totp');
  });

  it('MANDATORY: says explicitly that two-factor is not the problem', () => {
    // Because the screen it replaced implied the opposite, and that implication is what
    // cost somebody an evening.
    const src = read('app/(hub)/app/no-access.tsx');
    expect(src).toMatch(/not a two-factor problem/i);
  });

  it('names the permission, so an admin can grant exactly that one', () => {
    const src = read('app/(hub)/app/no-access.tsx');
    expect(src).toContain('permission');
  });
});

describe('the role editor can satisfy a fresh-2FA refusal in place', () => {
  /*
   * ★ THIS MOVED INTO A MODAL ON 2026-08-01, AND THE RULES DID NOT CHANGE ★
   *
   * Squadron owner: "the 2FA confirmation, should pop up in a modal please and it should auto
   * submit after the 6th digit is entered".
   *
   * The prompt used to be an <input> inline in the editor, and these guards named that shape
   * directly — `confirmAndSave`, `one-time-code`, `{needsCode && (`. All three broke on a change
   * that preserved every property they existed to protect.
   *
   * A guard that fails on correct work gets deleted, and the rule goes with it. So they now assert
   * the PROPERTIES across the component boundary instead of the layout of one file.
   */
  it('MANDATORY: a stale step-up on SAVE offers somewhere to enter a code', () => {
    /*
     * The second dead end. Saving a mask needs a step-up from the last two minutes, while reads
     * pass on the two-hour window — so the page renders normally and only the save fails, with
     * "confirm it again" and nowhere to do it.
     */
    const editor = code('app/(hub)/app/roles/role-editor.tsx');
    expect(editor).toContain('needsCode');
    expect(editor).toContain('TwoFactorModal');

    // Wherever the prompt lives, it has to actually verify against the API.
    expect(code('components/two-factor-modal.tsx')).toContain('/v1/auth/totp/verify');
  });

  it('MANDATORY: confirming retries the save rather than restarting the clock', () => {
    // Asking the operator to click Save again would start the two-minute window over
    // against them for no reason.
    const editor = code('app/(hub)/app/roles/role-editor.tsx');
    expect(editor).toMatch(/onConfirmed=/);
    expect(editor).toMatch(/await doSave\(\)/);
  });

  it('MANDATORY: the prompt is gated on state, not on matching the error text at render', () => {
    /*
     * `needsCode` is set once, when a save is refused for a stale step-up. Deriving it from
     * the error string during render would put a code box next to "you do not hold
     * ROLE_MANAGE" — the exact conflation this release fixes, moved into a component.
     */
    const editor = code('app/(hub)/app/roles/role-editor.tsx');
    expect(editor).toMatch(/open=\{needsCode\}/);
    expect(editor).not.toMatch(/error[^\n]*test\([^\n]*&&[^\n]*<input/);
  });

  it('MANDATORY: the code submits itself at the sixth digit', () => {
    /*
     * Squadron owner, 2026-08-01: it should behave "like the official authenticator does when we
     * first sign in". A TOTP code is complete at six digits — nothing to review, no seventh
     * character that could change the answer — so a Continue button is a keystroke the sign-in
     * flow already does not ask for, and asking for it here would make the site inconsistent with
     * itself.
     */
    const modal = code('components/two-factor-modal.tsx');
    expect(modal).toContain('CodeInput');
    expect(modal).toContain('onComplete');
  });

  it('MANDATORY: a rejected code is cleared rather than left to be resubmitted', () => {
    /*
     * A TOTP code is dead the moment it is rejected: its window has passed. Leaving the digits in
     * place invites submitting one that cannot possibly work — and under auto-submit it would fire
     * again the instant somebody typed a correction.
     */
    expect(code('components/two-factor-modal.tsx')).toMatch(/setCode\(''\)/);
  });

  it('MANDATORY: the modal can be dismissed', () => {
    // A modal with no way out but a correct code is a trap. The phone may be in another room, and
    // the honest response is to let somebody leave and come back.
    const modal = code('components/two-factor-modal.tsx');
    expect(modal).toContain('Escape');
    expect(modal).toContain('onCancel');
  });
});
