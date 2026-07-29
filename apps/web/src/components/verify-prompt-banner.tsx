import { cookies } from 'next/headers';
import { getMe } from '../lib/api';
import { VerifyBannerView, VERIFY_DISMISSED_COOKIE } from './verify-banner-view';

/**
 * "Get yourself verified" — for admins only, dismissible for one session.
 *
 * ★ WHY ADMINS ARE ASKED BUT NOT STOPPED ★
 *
 * Verification needs an officer to approve it. If officers were themselves held
 * pending verification, a fresh install has nobody able to approve anybody —
 * including themselves — and the queue jams on its first day with no way out
 * that does not involve the database.
 *
 * So they get a banner instead of a wall. They already hold the permissions
 * verification would confirm they deserve, so stopping them protects nothing
 * and only stops the person who has to clear everybody else's queue.
 *
 * ★ DISMISSIBLE, BUT NOT FORGETTABLE ★
 *
 * It can be closed for the session, because a permanent bar across every page
 * is a bar people stop seeing. It comes back on the next sign-in — the cookie
 * is cleared at logout, and the login redirect sends an unverified admin
 * straight to the page that fixes it.
 *
 * Dismissing means "not now". It must not be able to mean "never", because
 * nothing about the obligation has changed.
 *
 * ★ WHO NEVER SEES IT ★
 *
 * An ordinary member. They are stopped by the wall, on a page that exists to
 * explain the wait — a banner would be a second instruction competing with the
 * first. The SERVER decides this (`promptForVerification`), so the rule lives in
 * one place rather than being re-derived here.
 */
export async function VerifyPromptBanner() {
  const me = await getMe();
  if (!me.onboarding.promptForVerification) return null;

  /*
   * Read on the server so a dismissed banner is absent from the FIRST paint.
   * Rendering it and hiding it in the browser would flash it on every
   * navigation, which is worse than not having a dismiss button at all.
   */
  const jar = await cookies();
  if (jar.get(VERIFY_DISMISSED_COOKIE)?.value === '1') return null;

  return <VerifyBannerView />;
}
