import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A member waiting on verification must be able to verify themselves.
 *
 * ★ THE BUG THIS PINS, REPORTED FROM PRODUCTION 2026-07-29 ★
 *
 * "i have a user non-admin thats trying to join, they get to the verification
 * page but there is nothing for them to actually add their inara api key."
 *
 * The page offered "TWO WAYS THROUGH" and listed "Link an Inara key" as one of
 * them — with no form. The only form lived at
 * `/settings/commander?tab=verification`, inside the hub, and the hub layout
 * redirects anybody still owing onboarding straight back to this page.
 *
 * So it was a LOOP. The member was told to link a key, and every route to the
 * form bounced them here. The second "way through" was fictional, and the only
 * real one required finding an officer.
 *
 * ★ WHY THIS IS A SOURCE TEST ★
 *
 * The page is an async server component behind three API calls and an onboarding
 * gate that redirects admins away — reproducing it needs a non-admin member,
 * past the commander step, unverified, with no key. That was done by hand
 * against the running stack when this shipped, both before and after:
 *
 *   BEFORE the fix — has a key input: NO
 *   AFTER  the fix — has a key input: YES
 *
 * What can regress silently afterwards is somebody removing the form while the
 * page still talks about linking a key, which is visible right here.
 */
const PAGE = readFileSync(join(__dirname, 'verification', 'page.tsx'), 'utf8');

/** Comments are stripped: this page explains the loop at length. */
const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*/gm, '');

describe('the onboarding verification page', () => {
  it('MANDATORY: renders the Inara key form, not just a description of it', () => {
    expect(code).toContain('<InaraForm />');
  });

  it('wraps it in the provider the form needs', () => {
    // `InaraForm` reads shared state via `useVerification` and throws outside a
    // provider — so a form without this renders an error, not a field.
    expect(code).toMatch(/<VerificationProvider\s+initial=\{inara\}>/);
  });

  it('reuses the settings components rather than a second form', () => {
    // Two forms against one endpoint drift, and the drift shows up as one of
    // them quietly not working.
    expect(code).toMatch(/from '\.\.\/\.\.\/\.\.\/\(hub\)\/settings\/commander\/inara-form'/);
  });

  it('MANDATORY: still offers the officer route', () => {
    // The Inara key is not the only way through and must not become the only way
    // presented — plenty of members will not have an Inara account at all.
    expect(code).toContain('Ask an officer');
  });

  it('handles an unreadable status without claiming the account is broken', () => {
    // A null from the API must not render "add a key" to somebody who has one,
    // nor a blank card with no explanation.
    expect(code).toMatch(/inara === null \?/);
  });

  /*
   * Linking a key makes the member verified, which means this page no longer
   * applies to them. Without a live refresh they would sit on a waiting page
   * that had already stopped being true until they navigated by hand.
   */
  it('advances them automatically once the key is accepted', () => {
    expect(code).toMatch(/<LiveRefresh types=\{\['verification'\]\}/);
  });

  it('still bounces a member whose step this is not', () => {
    // The wall must not become a loop in the other direction either.
    expect(code).toMatch(/me\.onboarding\.step !== 'verification'/);
  });
});
