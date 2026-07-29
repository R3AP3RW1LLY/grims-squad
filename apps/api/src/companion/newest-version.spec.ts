import { describe, it, expect } from 'vitest';
import { newestVersion, newestRelease, type ReleaseAsset } from './release.service.js';

/**
 * Which published build counts as "latest".
 *
 * ★ THE COMPLAINT THIS ANSWERS ★
 *
 * Squadron owner, 2026-07-29: "every time we release a new build that is not
 * bumped we get the update notification and its really annoying to our members
 * please! not to mention confusing!"
 *
 * Two callers were each picking "latest" a different wrong way, and both were
 * visible to members:
 *
 *   the app's settings poll   sorted version STRINGS descending
 *   the website's rail        took the most recently BUILT file
 *
 * They now share one function, so the app and the site cannot disagree about
 * which build is current — which was its own source of confusion.
 */

const asset = (version: string | null, builtAt: string): ReleaseAsset => ({
  file: `Grims-Squad-Hub-${version ?? 'x'}-setup.exe`,
  platform: 'windows',
  version,
  sizeBytes: 1024,
  builtAt,
});

describe('newestVersion', () => {
  /*
   * ★ THE BUG THAT WOULD HAVE HIDDEN EVERY FUTURE UPDATE ★
   *
   * As strings, '0.10.0' < '0.9.0', because '1' sorts before '9'. The old sort
   * would have answered 0.9.0 — and from the tenth release onward the app would
   * have stopped being told about updates at all, silently.
   */
  it('MANDATORY: 0.10.0 beats 0.9.0', () => {
    const assets = [asset('0.9.0', '2026-07-01T00:00:00Z'), asset('0.10.0', '2026-07-02T00:00:00Z')];
    expect(newestVersion(assets)).toBe('0.10.0');
    // What the old string sort would have said, kept as the counter-example.
    expect(['0.9.0', '0.10.0'].sort((x, y) => (x < y ? 1 : -1))[0]).toBe('0.9.0');
  });

  /*
   * A rebuild of an older installer, or a failed prune leaving an old file with
   * a newer timestamp, must not promote a previous version.
   */
  it('MANDATORY: ignores build time entirely', () => {
    const assets = [
      asset('1.0.0', '2026-07-01T00:00:00Z'),
      // Built later, but an OLDER version.
      asset('0.9.0', '2026-07-20T00:00:00Z'),
    ];
    expect(newestVersion(assets)).toBe('1.0.0');
  });

  it('orders by each segment in turn', () => {
    const at = '2026-07-01T00:00:00Z';
    expect(newestVersion([asset('1.2.3', at), asset('1.2.10', at)])).toBe('1.2.10');
    expect(newestVersion([asset('1.9.0', at), asset('2.0.0', at)])).toBe('2.0.0');
  });

  it('treats a pre-release as its release version', () => {
    const at = '2026-07-01T00:00:00Z';
    // 1.2.0-beta.1 IS 1.2.0 code. Either answer is the same release.
    expect(newestVersion([asset('1.2.0-beta.1', at), asset('1.1.0', at)])).toBe('1.2.0-beta.1');
  });

  it('says nothing when nothing is published', () => {
    // An unreachable bucket returns an empty list. Announcing an update we
    // cannot name helps nobody.
    expect(newestVersion([])).toBeNull();
    expect(newestVersion([asset(null, '2026-07-01T00:00:00Z')])).toBeNull();
  });

  it('does not go NaN on a malformed version', () => {
    const at = '2026-07-01T00:00:00Z';
    // Every NaN comparison is false, which would make all versions look equal
    // and freeze the answer on whichever came first.
    expect(newestVersion([asset('1.x.0', at), asset('2.0.0', at)])).toBe('2.0.0');
  });

  it('ignores a leading v', () => {
    const at = '2026-07-01T00:00:00Z';
    expect(newestVersion([asset('v2.0.0', at), asset('1.9.0', at)])).toBe('v2.0.0');
  });
});

describe('newestRelease', () => {
  /*
   * ★ THE EARLIEST BUILD OF THE NEWEST VERSION ★
   *
   * The website's banner is bounded by a fortnight from release. Taking the
   * newest FILE would restart that fortnight on every rebuild — which is
   * exactly the "we get the notification again" complaint.
   */
  it('MANDATORY: a rebuild at the same version does not move the release date', () => {
    const first = asset('1.0.0', '2026-07-01T00:00:00Z');
    const rebuilt = asset('1.0.0', '2026-07-25T00:00:00Z');

    expect(newestRelease([first, rebuilt])?.builtAt).toBe('2026-07-01T00:00:00Z');
    // And the other way round in the list, so this does not depend on order.
    expect(newestRelease([rebuilt, first])?.builtAt).toBe('2026-07-01T00:00:00Z');
  });

  it('picks the newest VERSION, then its earliest build', () => {
    const assets = [
      asset('0.9.0', '2026-07-01T00:00:00Z'),
      asset('1.0.0', '2026-07-10T00:00:00Z'),
      asset('1.0.0', '2026-07-28T00:00:00Z'),
    ];
    const r = newestRelease(assets);
    expect(r?.version).toBe('1.0.0');
    expect(r?.builtAt).toBe('2026-07-10T00:00:00Z');
  });

  it('agrees with newestVersion', () => {
    const assets = [asset('0.9.0', '2026-07-20T00:00:00Z'), asset('0.10.0', '2026-07-01T00:00:00Z')];
    expect(newestRelease(assets)?.version).toBe(newestVersion(assets));
  });

  it('returns null when nothing is published', () => {
    expect(newestRelease([])).toBeNull();
    expect(newestRelease([asset(null, '2026-07-01T00:00:00Z')])).toBeNull();
  });
});
