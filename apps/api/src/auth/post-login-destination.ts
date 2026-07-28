import { safeRedirectPath, requiresTwoFactor, type PermissionMask } from '@grims/shared';

/**
 * Where a member lands after signing in.
 *
 * Human decision, 2026-07-27: securing an account has to be an automatic flow
 * the first time an admin signs in, or the moment a member is promoted into an
 * admin rank — not a list of links somebody is told to go and find. A standard
 * member goes to their own dashboard and gets a banner instead.
 *
 * ★ THIS IS ROUTING, NOT ENFORCEMENT ★
 *
 * Nothing here keeps anyone out. `AdminGateGuard` refuses the admin API without
 * a confirmed second factor no matter what the browser does, so typing /app by
 * hand gains nothing at all. If this file were the security, the security would
 * be a redirect — and a redirect is a suggestion.
 *
 * What this DOES do is make the right thing happen without anybody being told
 * to do it, which is the difference between a policy and a workflow.
 */

/** Forced flow: enrol a second factor, then continue. */
export const ONBOARDING_PATH = '/onboarding/security';
/** The admin console. */
export const ADMIN_PATH = '/app';
/** The members' area. */
export const MEMBER_PATH = '/dashboard';
/**
 * Where an unverified member who is NOT blocked lands.
 *
 * In practice that means admins: an ordinary member is held at
 * /onboarding/verification by the gate, and never reaches this. Admins are let
 * past because the approval queue would deadlock otherwise — so this is what
 * keeps the obligation in front of them instead.
 */
export const VERIFY_PATH = '/settings/commander?tab=verification';

export interface DestinationInput {
  /** EFFECTIVE mask — roles minus deny, as the permission engine computes it. */
  readonly mask: PermissionMask;
  readonly twoFactorEnrolled: boolean;
  /** Has anybody confirmed which commander they are? */
  readonly verified?: boolean | undefined;
  /** A ?redirect= from the sign-in link. Untrusted. */
  readonly requested?: string | undefined;
}

export async function postLoginDestination(input: DestinationInput): Promise<string> {
  const mustSecure = requiresTwoFactor(input.mask);

  /*
   * THE OBLIGATION WINS OVER THE REQUEST.
   *
   * A ?redirect=/app on the sign-in link would otherwise walk an unsecured
   * admin straight past the thing they are required to do — and that is exactly
   * the URL somebody bookmarks and shares. Checked BEFORE the requested path is
   * even considered.
   */
  if (mustSecure && !input.twoFactorEnrolled) return ONBOARDING_PATH;

  /*
   * ★ AN UNVERIFIED ADMIN LANDS ON THE PAGE THAT FIXES IT ★
   *
   * Also ahead of the requested path, and for the same reason: a bookmarked
   * ?redirect=/app would walk them past the one thing still outstanding.
   *
   * This repeats on EVERY sign-in until somebody verifies them. That is the
   * point — the banner can be dismissed for a session, so without this the
   * obligation would quietly disappear after the first dismissal and never come
   * back. Dismissing means "not now", not "never".
   */
  if (mustSecure && input.verified === false) return VERIFY_PATH;

  // Allowlisted, always. The value came from a query string, and honouring it
  // must never mean trusting it: an absolute URL here would be an open redirect
  // handed to a browser that has just authenticated.
  if (input.requested !== undefined && input.requested !== '') {
    const safe = safeRedirectPath(input.requested);
    // safeRedirectPath collapses anything unacceptable to '/', which is not a
    // useful destination for someone who just signed in — fall through to the
    // sensible default rather than dumping them on the public landing page.
    if (safe !== '/') return safe;
  }

  return mustSecure ? ADMIN_PATH : MEMBER_PATH;
}
