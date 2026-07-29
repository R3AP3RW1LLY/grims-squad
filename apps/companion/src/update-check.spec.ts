import { describe, it, expect } from 'vitest';
import { compareVersions, updateAvailable } from './update-check.js';

/**
 * Telling a member there is a new build.
 *
 * ★ A BANNER, NOT AN UPDATER ★
 *
 * Squadron owner's decision, 2026-07-29: no OTA. Without a code-signing
 * certificate an app that downloads and runs a binary by itself is worse than
 * one that sends the member to a page they can read.
 */
describe('comparing versions', () => {
  it('MANDATORY: 0.10.0 is newer than 0.9.0', () => {
    /*
     * ★ THE BUG THIS EXISTS TO PREVENT ★
     *
     * As STRINGS, '0.10.0' < '0.9.0', because '1' sorts before '9'. That is the
     * single most common way a version check silently stops working — and it
     * only starts failing at the tenth release, long after anybody is watching
     * for it.
     */
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(updateAvailable('0.9.0', '0.10.0')).toBe(true);
  });

  it('orders each segment numerically', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats a missing segment as zero', () => {
    // `1.2` and `1.2.0` are the same release written two ways.
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('ignores a leading v and a pre-release suffix', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0);
  });
});

describe('whether to show the banner', () => {
  it('MANDATORY: never on a null or empty latest version', () => {
    /*
     * Null means the hub published nothing, or could not be reached. A banner
     * then points at a download that does not exist — and a member who follows
     * it and finds nothing will ignore the next one, which will be real.
     */
    expect(updateAvailable('1.0.0', null)).toBe(false);
    expect(updateAvailable('1.0.0', '')).toBe(false);
    expect(updateAvailable('1.0.0', '   ')).toBe(false);
  });

  it('MANDATORY: not when already current, and not when AHEAD', () => {
    expect(updateAvailable('1.2.0', '1.2.0')).toBe(false);
    // A developer running a build newer than anything published must not be
    // told to downgrade.
    expect(updateAvailable('1.3.0', '1.2.0')).toBe(false);
  });

  it('MANDATORY: a garbled version does not hide real updates forever', () => {
    // Non-numeric segments become 0 rather than NaN. NaN comparisons are always
    // false, which would silently suppress every future banner.
    expect(updateAvailable('1.0.0', '1.0.1-rc')).toBe(true);
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
  });

  it('handles surrounding whitespace', () => {
    expect(updateAvailable(' 1.0.0 ', ' 1.1.0 ')).toBe(true);
  });
});
