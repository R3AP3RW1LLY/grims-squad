import { describe, it, expect } from 'vitest';
import {
  updateBanner,
  compareVersions,
  someDeviceBehind,
  appVersionSummary,
  withinWindow,
  BANNER_DAYS,
} from './update-banner-rules';

const NOW = Date.parse('2026-07-29T12:00:00Z');
const DAY = 86_400_000;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe('compareVersions', () => {
  /*
   * ★ THE BUG THIS EXISTS TO PREVENT ★
   *
   * String comparison says '0.10.0' < '0.9.0', so the tenth minor release would
   * be treated as older than the ninth — and every member who installed it
   * would be told to upgrade to a version they already had, forever. It only
   * appears after ten releases, by which time nobody is looking at this file.
   */
  it('MANDATORY: 0.10.0 is newer than 0.9.0', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect('0.10.0' < '0.9.0').toBe(true); // what a string compare would have said
  });

  it('orders by each segment in turn', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('ignores a pre-release suffix', () => {
    // Someone running 1.2.0-beta.1 has the 1.2.0 code. Telling them to update
    // to the version they are testing would be nonsense.
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0);
  });

  it('does not go NaN on a malformed segment', () => {
    // Every NaN comparison is false, which would silently make everything
    // "equal" and suppress the banner for all of them.
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.x.0', '2.0.0')).toBeLessThan(0);
  });
});

describe('someDeviceBehind', () => {
  /*
   * ★ THE COMPLAINT THIS ANSWERS ★
   *
   * Squadron owner, 2026-07-29: "every time we release a new build that is not
   * bumped we get the update notification and its really annoying to our
   * members please! not to mention confusing!"
   *
   * The rule this replaces (`allDevicesCurrent`) asked whether every device was
   * up to date and treated "we have not heard" as "out of date". That produced
   * a banner in the ABSENCE of evidence, which is the confusion being reported.
   * This one needs evidence of being behind.
   */
  it('MANDATORY: somebody with no app installed is never told to update', () => {
    // They have nothing to update. The download link in the status rail is
    // where somebody without the app is served, not a nag bar.
    expect(someDeviceBehind([], '1.0.0')).toBe(false);
  });

  it('MANDATORY: a device that has not reported yet is not assumed to be behind', () => {
    // Every device is null until its first poll. Assuming the worst nagged the
    // entire squadron the moment version reporting shipped.
    expect(someDeviceBehind([null], '1.0.0')).toBe(false);
    expect(someDeviceBehind([''], '1.0.0')).toBe(false);
  });

  it('MANDATORY: an unbumped rebuild changes nothing for somebody on that version', () => {
    // A rebuild publishes a new FILE with the same VERSION. Nobody is behind.
    expect(someDeviceBehind(['1.0.0'], '1.0.0')).toBe(false);
  });

  it('reports a device genuinely running something older', () => {
    expect(someDeviceBehind(['0.9.0'], '1.0.0')).toBe(true);
  });

  it('reports when only ONE of two machines is behind', () => {
    // Desktop updated, laptop not. That laptop really is out of date.
    expect(someDeviceBehind(['1.0.0', '0.9.0'], '1.0.0')).toBe(true);
  });

  it('ignores a device running something NEWER than the bucket', () => {
    // A developer build, or a release mid-publish. Not somebody to nag.
    expect(someDeviceBehind(['1.1.0'], '1.0.0')).toBe(false);
  });

  it('compares a mix of known and unknown on the known ones alone', () => {
    expect(someDeviceBehind(['1.0.0', null], '1.0.0')).toBe(false);
    expect(someDeviceBehind(['0.9.0', null], '1.0.0')).toBe(true);
  });
});

describe('withinWindow', () => {
  it(`covers ${BANNER_DAYS} days`, () => {
    expect(withinWindow(ago(1 * DAY), NOW)).toBe(true);
    expect(withinWindow(ago(BANNER_DAYS * DAY - 1), NOW)).toBe(true);
  });

  it('expires after that', () => {
    expect(withinWindow(ago(BANNER_DAYS * DAY + DAY), NOW)).toBe(false);
  });

  it('says nothing when the release has no date', () => {
    // A banner that never expires is a banner people learn to ignore, and we
    // cannot call something recent without knowing when it happened.
    expect(withinWindow(null, NOW)).toBe(false);
    expect(withinWindow('not a date', NOW)).toBe(false);
  });

  it('treats a future timestamp as brand new', () => {
    // A build stamped ahead of us is a clock problem on the builder, not a
    // reason to hide a release that plainly exists.
    expect(withinWindow(new Date(NOW + DAY).toISOString(), NOW)).toBe(true);
  });
});

describe('updateBanner', () => {
  const fresh = { latestVersion: '1.0.0', releasedAt: ago(2 * DAY) };

  it('announces a new release to somebody running an old one', () => {
    expect(updateBanner({ ...fresh, deviceVersions: ['0.9.0'] }, NOW)).toBe('1.0.0');
  });

  it('MANDATORY: says nothing to somebody who has never installed the app', () => {
    /*
     * This used to announce, on the reasoning that a release is most useful to
     * somebody who has never installed it. That was wrong: it is an UPDATE
     * banner, and there is nothing to update. Somebody without the app is
     * served by the download link in the commander status rail.
     */
    expect(updateBanner({ ...fresh, deviceVersions: [] }, NOW)).toBeNull();
  });

  it('MANDATORY: says nothing while a device has not yet reported', () => {
    expect(updateBanner({ ...fresh, deviceVersions: [null] }, NOW)).toBeNull();
  });

  it('MANDATORY: a rebuild at the same version does not start nagging again', () => {
    /*
     * The exact complaint. A rebuild moves the release date, so a rule keyed on
     * "is this release recent" fires all over again for people who are already
     * on it. Keyed on the VERSION, nothing happens.
     */
    expect(
      updateBanner(
        { latestVersion: '1.0.0', releasedAt: ago(1000), deviceVersions: ['1.0.0'] },
        NOW,
      ),
    ).toBeNull();
  });

  /* The squadron owner's second condition, and the one that matters most. */
  it('MANDATORY: says nothing to somebody already on the newest', () => {
    expect(updateBanner({ ...fresh, deviceVersions: ['1.0.0'] }, NOW)).toBeNull();
  });

  it('MANDATORY: stops after the window, even for somebody still behind', () => {
    expect(
      updateBanner(
        { latestVersion: '1.0.0', releasedAt: ago(20 * DAY), deviceVersions: ['0.9.0'] },
        NOW,
      ),
    ).toBeNull();
  });

  it('says nothing when the release store gave us nothing', () => {
    // Unreachable bucket, or no release yet. Announcing an update we cannot
    // name helps nobody.
    expect(updateBanner({ latestVersion: null, releasedAt: ago(DAY), deviceVersions: [] }, NOW))
      .toBeNull();
    expect(updateBanner({ latestVersion: '', releasedAt: ago(DAY), deviceVersions: [] }, NOW))
      .toBeNull();
  });

  it('keeps announcing while one of two machines is behind', () => {
    expect(updateBanner({ ...fresh, deviceVersions: ['1.0.0', '0.9.0'] }, NOW)).toBe('1.0.0');
  });

  it('does not regress on the tenth minor release', () => {
    // The string-comparison bug, end to end: a member on 0.10.0 must not be
    // told to install 0.9.0.
    expect(
      updateBanner(
        { latestVersion: '0.9.0', releasedAt: ago(DAY), deviceVersions: ['0.10.0'] },
        NOW,
      ),
    ).toBeNull();
  });
});


/**
 * The companion-app row in the commander status rail.
 *
 * ★ WHY IT IS TESTED BESIDE THE BANNER ★
 *
 * Squadron owner, 2026-07-29: show the member's version in the status box, link
 * to the download page when they have not got it, and show the banner only on a
 * real mismatch.
 *
 * The rail and the banner are two views of ONE fact. Deriving them separately is
 * how a member gets a bar saying "update available" above a panel saying they
 * are current — worse than either message alone. These tests assert the two
 * never disagree.
 */
describe('appVersionSummary', () => {
  const at = (deviceVersions: Array<string | null>, latestVersion: string | null = '1.0.0') => ({
    latestVersion,
    releasedAt: ago(DAY),
    deviceVersions,
  });

  it('sends somebody without the app to the download page', () => {
    const r = appVersionSummary(at([]));
    expect(r.label).toBe('Not installed');
    expect(r.href).toBe('/settings/devices');
    expect(r.linkText).toMatch(/get the companion app/i);
  });

  it('says it is waiting when a paired device has not reported yet', () => {
    // NOT "Unknown" as a bare word — that reads as an error, and would have
    // somebody re-pairing a device that is working perfectly well.
    const r = appVersionSummary(at([null]));
    expect(r.label).toBe('Waiting for the app');
    expect(r.href).toBeNull();
  });

  it('shows the version, and nothing else, when current', () => {
    const r = appVersionSummary(at(['1.0.0']));
    expect(r.label).toBe('v1.0.0');
    expect(r.tone).toBe('good');
    // No link. There is nothing to do, and an action here would imply otherwise.
    expect(r.href).toBeNull();
  });

  it('names both versions when behind, and offers the update', () => {
    const r = appVersionSummary(at(['0.9.0']));
    expect(r.label).toBe('v0.9.0 — v1.0.0 available');
    expect(r.tone).toBe('warn');
    expect(r.href).toBe('/settings/devices');
  });

  it('reports the OLDEST machine, not the newest', () => {
    // A current desktop and a stale laptop is not up to date. Showing the newer
    // number would hide the one that needs attention.
    const r = appVersionSummary(at(['1.0.0', '0.9.0']));
    expect(r.label).toContain('v0.9.0');
    expect(r.tone).toBe('warn');
  });

  it('is calm about a device running something newer than the bucket', () => {
    const r = appVersionSummary(at(['1.1.0']));
    expect(r.tone).toBe('good');
    expect(r.label).toBe('v1.1.0');
  });

  it('shows the installed version even when the bucket says nothing', () => {
    // An unreachable release store must not turn into "Not installed" for
    // somebody who plainly has it.
    const r = appVersionSummary(at(['1.0.0'], null));
    expect(r.label).toBe('v1.0.0');
    expect(r.tone).toBe('good');
  });

  it('never returns a blank label', () => {
    // An empty stat in a status panel reads as broken.
    for (const devices of [[], [null], [''], ['1.0.0'], ['0.9.0'], ['1.0.0', null]]) {
      expect(appVersionSummary(at(devices as Array<string | null>)).label.trim()).not.toBe('');
    }
  });

  /*
   * ★ THE ONE THAT MATTERS ★
   *
   * The rail and the banner must never contradict each other. If the banner is
   * showing, the rail must be warning; if it is silent, the rail must not be.
   */
  it('MANDATORY: agrees with the banner in every case', () => {
    const cases: Array<Array<string | null>> = [
      [],
      [null],
      [''],
      ['1.0.0'],
      ['0.9.0'],
      ['1.1.0'],
      ['1.0.0', '0.9.0'],
      ['1.0.0', null],
      ['0.9.0', null],
    ];

    for (const devices of cases) {
      const input = at(devices);
      const banner = updateBanner(input, NOW) !== null;
      const rail = appVersionSummary(input).tone === 'warn';
      expect(rail, `devices ${JSON.stringify(devices)}`).toBe(banner);
    }
  });
});
