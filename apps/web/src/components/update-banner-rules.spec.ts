import { describe, it, expect } from 'vitest';
import {
  updateBanner,
  compareVersions,
  allDevicesCurrent,
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

describe('allDevicesCurrent', () => {
  /*
   * ★ `[].every()` IS TRUE, AND THAT WOULD HAVE BEEN A REAL BUG ★
   *
   * It would hide the release announcement from exactly the people who have
   * never installed the app — the ones it is most useful to.
   */
  it('MANDATORY: a member with no devices is not "up to date"', () => {
    expect(allDevicesCurrent([], '1.0.0')).toBe(false);
  });

  it('is true only when every device is on the newest', () => {
    expect(allDevicesCurrent(['1.0.0'], '1.0.0')).toBe(true);
    expect(allDevicesCurrent(['1.0.0', '1.0.0'], '1.0.0')).toBe(true);
    // Desktop updated, laptop not. Telling them they are current would be wrong
    // for one of the two machines they actually use.
    expect(allDevicesCurrent(['1.0.0', '0.9.0'], '1.0.0')).toBe(false);
  });

  it('counts a device that has never reported as not current', () => {
    // It might be on the newest build and simply not have polled. Assuming so
    // would hide the banner on a guess; showing it to somebody already current
    // fixes itself within five minutes.
    expect(allDevicesCurrent([null], '1.0.0')).toBe(false);
    expect(allDevicesCurrent(['1.0.0', null], '1.0.0')).toBe(false);
  });

  it('accepts a device running something NEWER than the bucket', () => {
    // A developer build, or a release mid-publish. Not somebody to nag.
    expect(allDevicesCurrent(['1.1.0'], '1.0.0')).toBe(true);
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

  it('announces it to somebody who has never installed the app', () => {
    expect(updateBanner({ ...fresh, deviceVersions: [] }, NOW)).toBe('1.0.0');
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
