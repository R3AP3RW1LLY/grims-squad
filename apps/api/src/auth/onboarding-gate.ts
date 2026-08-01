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
 *   3. THE COMPANION APP, for everybody. It is what produces the journal data
 *      verification is judged on, so asking afterwards means arriving at the
 *      queue with nothing to be verified by.
 *   4. VERIFICATION, for everybody EXCEPT admins. Somebody has to confirm which
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

export type OnboardingStep = 'security' | 'commander' | 'companion' | 'verification' | null;

export interface OnboardingState {
  /** Holds permissions that require a second factor. */
  readonly privileged: boolean;
  readonly twoFactorEnrolled: boolean;
  /** Has finished the commander settings step. */
  readonly commanderOnboarded: boolean;
  /** Somebody has confirmed which commander they are. */
  readonly verified: boolean;
  /**
   * Has been shown the companion app step.
   *
   * SEEN, not installed. See the column comment — requiring a paired device would wall out anybody
   * whose machine cannot run it, and the squadron would rather have them in the forum than nowhere.
   */
  readonly companionPrompted: boolean;
}

/** Where to send them, or null when they owe nothing. */
export const ONBOARDING_PATHS: Record<Exclude<OnboardingStep, null>, string> = {
  security: '/onboarding/security',
  commander: '/onboarding/commander',
  companion: '/onboarding/companion',
  verification: '/onboarding/verification',
};

export function nextOnboardingStep(state: OnboardingState): OnboardingStep {
  if (state.privileged && !state.twoFactorEnrolled) return 'security';
  if (!state.commanderOnboarded) return 'commander';

  /*
   * ★ THE COMPANION, BEFORE VERIFICATION AND NOT AFTER — squadron owner, 2026-08-01 ★
   *
   * "onboarding download step"
   *
   * The order is the argument. Verification is an officer confirming which commander somebody is,
   * and the evidence for that comes from the journal the companion uploads. Asking for the app
   * AFTER verification would mean every member reaches the queue with nothing to verify them by,
   * which is roughly what has happened: six of fifty-six members have a paired device.
   *
   * It does not block. `companionPrompted` is set by passing through the page, so somebody who
   * cannot run it continues to verification on the same visit — but they continue having been
   * told what it is for, which is the whole point of a step.
   */
  if (!state.companionPrompted) return 'companion';

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
