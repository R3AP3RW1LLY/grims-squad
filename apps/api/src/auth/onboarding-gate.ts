/**
 * What a member must do before the hub will let them in.
 *
 * ★ ONE FUNCTION, BECAUSE THE ORDER IS THE HARD PART ★
 *
 * There are three obligations and they are not independent. Scattering them
 * across page guards means each one only knows about itself, and the member
 * ends up bounced between two pages that each think the other should have run
 * first.
 *
 * The order below is deliberate:
 *
 *   1. SECURITY, for privileged accounts. An admin without a second factor is
 *      the largest risk on the platform, and nothing else is worth doing until
 *      it is closed.
 *   2. COMMANDER SETTINGS, for everybody. Cheap, thirty seconds, and every time
 *      shown afterwards depends on it — asking later means showing wrong times
 *      in the meantime.
 *   3. VERIFICATION, for everybody EXCEPT admins. Somebody has to confirm which
 *      commander a member is before their activity counts for anything.
 *
 * ★ WHY ADMINS SKIP THE VERIFICATION WALL ★
 *
 * Verification needs an officer to approve it. If officers were themselves
 * blocked pending verification, a fresh install has nobody able to approve
 * anyone — including themselves. The queue would deadlock on its first day.
 *
 * They still owe it, and are told so on every page until it is done. The
 * difference is a banner rather than a wall: they already hold the permissions
 * verification would confirm they deserve, so blocking them protects nothing.
 */

export type OnboardingStep = 'security' | 'commander' | 'verification' | null;

export interface OnboardingState {
  /** Holds permissions that require a second factor. */
  readonly privileged: boolean;
  readonly twoFactorEnrolled: boolean;
  /** Has finished the commander settings step. */
  readonly commanderOnboarded: boolean;
  /** Somebody has confirmed which commander they are. */
  readonly verified: boolean;
}

/** Where to send them, or null when they owe nothing. */
export const ONBOARDING_PATHS: Record<Exclude<OnboardingStep, null>, string> = {
  security: '/onboarding/security',
  commander: '/onboarding/commander',
  verification: '/onboarding/verification',
};

export function nextOnboardingStep(state: OnboardingState): OnboardingStep {
  if (state.privileged && !state.twoFactorEnrolled) return 'security';
  if (!state.commanderOnboarded) return 'commander';

  /*
   * The exception, and the reason this is a function rather than three ifs in a
   * layout. An admin who is not verified is NOT held here — see the note above
   * about the queue deadlocking on day one.
   */
  if (!state.verified && !state.privileged) return 'verification';

  return null;
}

/**
 * Should we nag them about verification without blocking?
 *
 * True only for the admins the wall deliberately lets past. Everybody else
 * either does not owe it or has already been stopped, and a banner shown to
 * somebody who cannot act on it is noise.
 */
export function shouldPromptForVerification(state: OnboardingState): boolean {
  return state.privileged && !state.verified && state.commanderOnboarded;
}
