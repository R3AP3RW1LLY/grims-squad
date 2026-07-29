import { cookies } from 'next/headers';
import { getUpdateStatus } from '../lib/api';
import { updateBanner, BANNER_DAYS, updateDismissedCookie } from './update-banner-rules';
import { UpdateBannerView } from './update-banner-view';

/**
 * "A new companion release is out" — for members who have not installed it.
 *
 * ★ WHAT WAS ASKED FOR ★
 *
 * Squadron owner, 2026-07-29: a banner for fourteen days or until the member has
 * the update, hidden entirely from anybody already on the newest version.
 *
 * ★ THE HARD PART IS KNOWING WHAT THEY ARE RUNNING ★
 *
 * Nothing recorded it. The release bucket knew what the newest version WAS, and
 * the member's account knew nothing about what was actually installed — so a
 * banner could only ever have been dismissed by hand or shown to everybody
 * forever, including the people who updated the day it shipped.
 *
 * The companion now reports its version on the settings poll it already makes
 * every five minutes, and that is what makes "hidden from that user if they are
 * using the newest version" possible at all.
 *
 * ★ DECIDED ON THE SERVER ★
 *
 * Rendering it and hiding it in the browser would flash an update notice at
 * somebody who is already current, on every navigation — which is worse than
 * having no banner. The rule lives in `update-banner-rules.ts`, tested, in one
 * place.
 */
export async function UpdateBanner() {
  const status = await getUpdateStatus();

  /*
   * Null covers a signed-out visitor, an unreachable release store, and an API
   * that is down. All three mean the same thing here: we do not know enough to
   * announce anything, so we announce nothing.
   */
  if (status === null) return null;

  const version = updateBanner(status);
  if (version === null) return null;

  /*
   * Dismissal is keyed to the VERSION.
   *
   * A single "dismissed" flag would silence every future release too — somebody
   * who closed the 1.0.0 banner would never hear about 1.1.0, and the feature
   * would decay into nothing without anybody noticing. Closing this one closes
   * this one.
   */
  const jar = await cookies();
  if (jar.get(updateDismissedCookie(version))?.value === '1') return null;

  return <UpdateBannerView version={version} days={BANNER_DAYS} />;
}
