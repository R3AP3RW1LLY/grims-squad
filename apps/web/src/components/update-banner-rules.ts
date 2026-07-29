/**
 * Whether to tell a member a new companion release is out.
 *
 * ★ WHAT WAS ASKED FOR ★
 *
 * Squadron owner, 2026-07-29: "when a new app release is released, we need to
 * change the version number on the download button, and add a banner to the
 * website for 14 days or until the user has downloaded the update. then the
 * banner should be hidden from that user if they are using the newest version."
 *
 * Three conditions, and all three have to hold. The interesting part is what
 * happens when we do not KNOW — which, on a page shown to everybody, is most
 * people most of the time.
 */

/** How long a release stays newsworthy. */
export const BANNER_DAYS = 14;

export interface BannerInput {
  /** Newest published version, or null when the release store said nothing. */
  readonly latestVersion: string | null;
  /** When it was published. Drives the fourteen days. */
  readonly releasedAt: string | null;
  /**
   * What each of this member's active devices last reported.
   *
   * Null entries are devices that have not checked in since version reporting
   * shipped. PER DEVICE because somebody with a desktop and a laptop can have
   * updated one and not the other.
   */
  readonly deviceVersions: readonly (string | null)[];
}

/**
 * Compares two versions numerically, segment by segment.
 *
 * String comparison is wrong in a way that only shows up after ten releases:
 * `'0.10.0' < '0.9.0'` is true, so the tenth minor version would be treated as
 * older than the ninth and every member on it told to upgrade — forever.
 *
 * Returns a negative number when `a` is older, positive when newer, 0 when the
 * same. A pre-release suffix is ignored: `1.2.0-beta.1` and `1.2.0` are the same
 * release for the purpose of "do you need to update".
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    /*
     * `?? ''` rather than a non-null assertion. `split` on a non-empty string
     * always yields a first element, but asserting that is a promise to the
     * compiler rather than a fact it can check — and an empty version string
     * would make the assertion a lie that only shows up at runtime.
     */
    (v.split('-')[0] ?? '')
      .split('.')
      .map((n) => {
        const parsed = Number.parseInt(n, 10);
        // A non-numeric segment sorts as 0 rather than NaN. NaN comparisons are
        // all false, which would silently make every comparison "equal".
        return Number.isFinite(parsed) ? parsed : 0;
      });

  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    // A missing segment is zero, so 1.2 and 1.2.0 compare equal.
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Is this member already running the newest release on every device? */
export function allDevicesCurrent(
  deviceVersions: readonly (string | null)[],
  latestVersion: string,
): boolean {
  /*
   * ★ NO DEVICES IS NOT "UP TO DATE" ★
   *
   * `[].every(...)` is true, which would have hidden the banner from precisely
   * the people who have never installed the app — the ones a release
   * announcement is most useful to.
   */
  if (deviceVersions.length === 0) return false;

  /*
   * A device that has never reported counts as NOT current.
   *
   * It might be running the newest build and simply not have polled yet, but
   * assuming so would hide the banner on a guess. Showing an update notice to
   * somebody who is already current is a small annoyance that fixes itself
   * within five minutes; hiding it from somebody who is not is the failure this
   * feature exists to prevent.
   */
  return deviceVersions.every((v) => v !== null && compareVersions(v, latestVersion) >= 0);
}

/** Has the release passed its fourteen days? */
export function withinWindow(
  releasedAt: string | null,
  now: number = Date.now(),
  days: number = BANNER_DAYS,
): boolean {
  // No date, no window. We cannot claim something is recent without knowing
  // when it happened, and a banner that never expires is a banner people learn
  // to ignore.
  if (releasedAt === null) return false;

  const at = new Date(releasedAt).getTime();
  if (!Number.isFinite(at)) return false;

  const age = now - at;
  // A build stamped in the future is a clock problem, not a reason to hide a
  // release. Treated as brand new.
  if (age < 0) return true;

  return age <= days * 86_400_000;
}

/**
 * The whole decision.
 *
 * Returns the version to announce, or null for "say nothing". A single function
 * so the rule lives in one place — three conditions spread across a component
 * is how one of them quietly stops being checked.
 */
export function updateBanner(input: BannerInput, now: number = Date.now()): string | null {
  const { latestVersion, releasedAt, deviceVersions } = input;

  // Nothing published, or the release store was unreachable. Silence is the
  // honest answer; announcing an update we cannot name helps nobody.
  if (latestVersion === null || latestVersion === '') return null;

  if (!withinWindow(releasedAt, now)) return null;
  if (allDevicesCurrent(deviceVersions, latestVersion)) return null;

  return latestVersion;
}

/**
 * The cookie that hides one particular release's banner.
 *
 * ★ KEYED TO THE VERSION, AND THAT IS THE WHOLE POINT ★
 *
 * A single `gs_update_dismissed` flag would silence every FUTURE release as
 * well. Somebody who closed the banner for 1.0.0 would never be told about
 * 1.1.0, and the feature would quietly stop working for exactly the members who
 * had used it once — with no symptom anybody would report.
 *
 * ★ AND IT LIVES HERE, NOT BESIDE THE VIEW ★
 *
 * It started in the `'use client'` component next to the button that sets it,
 * which read well and did not work: the SERVER decides whether to render the
 * banner at all, and Next refuses to call a function exported from a client
 * module. The name is needed on both sides, so it belongs in the module that
 * belongs to neither.
 *
 * Everything but letters and digits becomes an underscore — a cookie name may
 * not contain a dot in every parser, and a name that silently fails to set
 * means a banner that cannot be dismissed.
 */
export function updateDismissedCookie(version: string): string {
  return `gs_update_${version.replace(/[^0-9A-Za-z]/g, '_')}`;
}
