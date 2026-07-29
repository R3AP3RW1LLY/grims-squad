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

/**
 * Is at least one of this member's machines running something OLDER?
 *
 * ★ A MISMATCH, NOT AN ABSENCE ★
 *
 * Squadron owner, 2026-07-29: "every time we release a new build that is not
 * bumped we get the update notification and its really annoying to our members
 * please! not to mention confusing!" — and: show the banner when there is a
 * version mismatch, and not otherwise.
 *
 * This replaces `allDevicesCurrent`, which asked the opposite question and got
 * two cases badly wrong:
 *
 *   no devices at all         counted as "not current", so somebody who has
 *                             never installed the app was shown an update
 *                             notice for software they do not have
 *
 *   device has not reported   counted as "not current", so every member was
 *                             nagged until their app next polled — which is
 *                             every member, every time, for the first five
 *                             minutes after this shipped
 *
 * Both produced a banner in the absence of evidence. The rule now needs
 * EVIDENCE OF BEING BEHIND: a version we have actually been told, that is
 * genuinely older than the published one. Silence when we do not know.
 *
 * ★ WHY THIS ALSO FIXES THE REBUILD COMPLAINT ★
 *
 * Rebuilding without bumping publishes a new FILE with the same VERSION. The
 * release date moves, so any rule keyed on "is the release recent" fires again.
 * This one compares versions, so an unbumped rebuild changes nothing for
 * anybody already on that version.
 */
export function someDeviceBehind(
  deviceVersions: readonly (string | null)[],
  latestVersion: string,
): boolean {
  /*
   * Only devices that have TOLD us what they run. A null is "we have not
   * heard", which is not the same as "out of date" — and treating it as such is
   * exactly the confusion being complained about.
   */
  const known = deviceVersions.filter((v): v is string => v !== null && v.trim() !== '');

  // Nothing to compare: no app, or no report yet. Say nothing.
  if (known.length === 0) return false;

  /*
   * `some`, not `every`. Somebody with a desktop and a laptop who has updated
   * only one of them genuinely does have an out-of-date machine, and telling
   * them so is the point.
   *
   * A device running something NEWER than the bucket — a developer build, or a
   * release mid-publish — is not behind and is not nagged.
   */
  return known.some((v) => compareVersions(v, latestVersion) < 0);
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

  /*
   * ★ THE MISMATCH IS CHECKED FIRST, AND IT IS THE REAL GATE ★
   *
   * Somebody already on the newest version must never see this, however recent
   * the release is — that is the complaint this exists to answer.
   */
  if (!someDeviceBehind(deviceVersions, latestVersion)) return null;

  /*
   * The window is now only an UPPER BOUND on how long a genuine mismatch keeps
   * nagging. It is not what decides whether to nag: a rebuild without a version
   * bump moves the release date and would otherwise start the fortnight again
   * for people who are perfectly up to date.
   */
  if (!withinWindow(releasedAt, now)) return null;

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

/** What the commander status rail should say about the companion app. */
export interface AppVersionSummary {
  /** The row's value. Never blank — an empty stat reads as broken. */
  readonly label: string;
  readonly tone: 'good' | 'warn' | 'default';
  /** Where to send them, when there is somewhere useful to go. */
  readonly href: string | null;
  /** The text of that link. */
  readonly linkText: string | null;
}

/**
 * The companion app's state, for the status rail on Commander Management.
 *
 * ★ WHY IT LIVES BESIDE THE BANNER RULE ★
 *
 * Squadron owner, 2026-07-29: show the member's app version in the status box;
 * link to the download page when they do not have it; and show the update
 * banner only on a genuine mismatch.
 *
 * The rail and the banner are two views of one fact. Computing them separately
 * is how a member ends up with a bar saying "update available" above a panel
 * saying they are current — which is worse than either message alone, and is
 * precisely the confusion being complained about. Same inputs, same file.
 *
 * ★ FOUR STATES, BECAUSE THERE ARE FOUR ★
 *
 *   no devices        never installed, or unpaired everything -> send them to
 *                     the download page
 *   nothing reported  paired, but has not checked in since version reporting
 *                     shipped -> say so plainly rather than inventing a version
 *   behind            a real mismatch -> name both versions
 *   current           say the version and get out of the way
 */
export function appVersionSummary(
  input: BannerInput & { readonly deviceCount?: number },
): AppVersionSummary {
  const { latestVersion, deviceVersions } = input;

  const known = deviceVersions.filter((v): v is string => v !== null && v.trim() !== '');

  if (deviceVersions.length === 0) {
    return {
      label: 'Not installed',
      tone: 'default',
      href: '/settings/devices',
      linkText: 'Get the companion app',
    };
  }

  if (known.length === 0) {
    /*
     * Paired, but silent. NOT "unknown" as a bare word — that reads as an
     * error. The app reports on a five-minute poll, so the honest answer is
     * that it has not checked in yet, and saying when it will is what stops
     * somebody re-pairing a device that is working perfectly well.
     */
    return {
      label: 'Waiting for the app',
      tone: 'default',
      href: null,
      linkText: null,
    };
  }

  /*
   * The OLDEST machine decides the row. Somebody with a current desktop and a
   * stale laptop is not up to date, and showing the newer number would hide the
   * one that needs attention.
   */
  const oldest = known.reduce((a, b) => (compareVersions(b, a) < 0 ? b : a));

  if (latestVersion !== null && latestVersion !== '' && compareVersions(oldest, latestVersion) < 0) {
    return {
      label: `v${oldest} — v${latestVersion} available`,
      tone: 'warn',
      href: '/settings/devices',
      linkText: 'Update the companion app',
    };
  }

  // Current, or ahead of the bucket. Either way, nothing to do.
  return { label: `v${oldest}`, tone: 'good', href: null, linkText: null };
}
