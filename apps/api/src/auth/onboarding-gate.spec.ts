import { describe, it, expect } from 'vitest';
import {
  nextOnboardingStep,
  shouldPromptForVerification,
  ONBOARDING_PATHS,
  type OnboardingState,
} from './onboarding-gate.js';

/**
 * What a member owes before the hub lets them in.
 *
 * ★ THE ORDER IS THE HARD PART ★
 *
 * Three obligations that are not independent. Decided in one place because
 * scattering them across page guards means each knows only about itself, and
 * the member gets bounced between two pages that each think the other should
 * have run first.
 */

const base: OnboardingState = {
  privileged: false,
  twoFactorEnrolled: false,
  commanderOnboarded: false,
  verified: false,
};

describe('an ordinary member', () => {
  it('MANDATORY: does commander settings first', () => {
    // Cheap, thirty seconds, and every time shown afterwards depends on it.
    expect(nextOnboardingStep(base)).toBe('commander');
  });

  it('MANDATORY: is then held until somebody verifies them', () => {
    expect(nextOnboardingStep({ ...base, commanderOnboarded: true })).toBe('verification');
  });

  it('is let in once verified', () => {
    expect(
      nextOnboardingStep({ ...base, commanderOnboarded: true, verified: true }),
    ).toBeNull();
  });

  it('MANDATORY: is never asked for a second factor', () => {
    /*
     * Two-factor is required only of accounts that can affect other members.
     * Demanding it of everybody would put an authenticator app between a
     * hundred casual players and a squadron roster, and most would simply not
     * come back.
     */
    expect(nextOnboardingStep({ ...base, commanderOnboarded: true, verified: true })).toBeNull();
    expect(nextOnboardingStep(base)).not.toBe('security');
  });
});

describe('an admin', () => {
  const admin: OnboardingState = { ...base, privileged: true };

  it('MANDATORY: secures the account BEFORE anything else', () => {
    /*
     * An admin without a second factor is the largest single risk on the
     * platform. Nothing else is worth doing until it is closed — including the
     * commander step, which is thirty seconds of convenience by comparison.
     */
    expect(nextOnboardingStep(admin)).toBe('security');
  });

  it('then does the same commander step everybody does', () => {
    // The point of the requirement: admins are not exempt from configuring
    // their own account, only from waiting to be vouched for.
    expect(nextOnboardingStep({ ...admin, twoFactorEnrolled: true })).toBe('commander');
  });

  it('MANDATORY: is NOT held pending verification', () => {
    /*
     * ★ THE DEADLOCK THIS AVOIDS ★
     *
     * Verification needs an officer to approve it. If officers were themselves
     * blocked pending verification, a fresh install has nobody able to approve
     * anybody — including themselves — and the queue jams on its first day
     * with no way out that does not involve the database.
     */
    expect(
      nextOnboardingStep({ ...admin, twoFactorEnrolled: true, commanderOnboarded: true }),
    ).toBeNull();
  });

  it('MANDATORY: is still asked, just not blocked', () => {
    // They owe it. The difference is a banner rather than a wall — they already
    // hold the permissions verification would confirm, so a wall protects
    // nothing and only stops the person who has to clear the queue.
    expect(
      shouldPromptForVerification({
        ...admin,
        twoFactorEnrolled: true,
        commanderOnboarded: true,
      }),
    ).toBe(true);
  });

  it('stops being asked once verified', () => {
    expect(
      shouldPromptForVerification({
        ...admin,
        twoFactorEnrolled: true,
        commanderOnboarded: true,
        verified: true,
      }),
    ).toBe(false);
  });

  it('MANDATORY: is not nagged before finishing the step that comes first', () => {
    // A banner about verification, shown on the page telling them to configure
    // their timezone, is two instructions competing. The first one wins.
    expect(
      shouldPromptForVerification({ ...admin, twoFactorEnrolled: true, commanderOnboarded: false }),
    ).toBe(false);
  });
});

describe('nobody is prompted who cannot act', () => {
  it('MANDATORY: an ordinary member never sees the verification banner', () => {
    /*
     * They are stopped by the WALL instead, so a banner would be a second
     * instruction on a page that already exists to give them the first. Showing
     * it to somebody already blocked is noise.
     */
    expect(shouldPromptForVerification({ ...base, commanderOnboarded: true })).toBe(false);
  });
});

describe('the destinations', () => {
  it('every step has somewhere to send them', () => {
    for (const step of ['security', 'commander', 'verification'] as const) {
      expect(ONBOARDING_PATHS[step], step).toMatch(/^\/onboarding\//);
    }
  });

  it('MANDATORY: none of them is inside the members area', () => {
    /*
     * They live under (site). A gate that redirected INTO the area it guards
     * would redirect to itself forever, and the member would see a browser
     * error rather than a form.
     */
    for (const path of Object.values(ONBOARDING_PATHS)) {
      expect(path.startsWith('/settings') || path.startsWith('/app')).toBe(false);
    }
  });
});
