import { describe, it, expect } from 'vitest';
import { INSTALL_RETRY_MS, UPDATE_CHECK_MS, mayInstall, FORCED_INSTALL_GRACE_MS, FORCED_INSTALL_TICK_MS } from './auto-update.js';

/**
 * When an update may be applied.
 *
 * ★ THE RULE THAT MATTERS ★
 *
 * Downloading is free; INSTALLING relaunches the app. Doing that mid-session drops the journal
 * watcher for however long the installer takes, so the member loses telemetry from exactly the
 * session they were most likely playing — and puts an installer window over a running game.
 *
 * The decision is extracted and pure because the Electron main process cannot be unit tested, and
 * that is precisely where this app's last bad assumption ("one 401 means the token is dead") lived
 * unchallenged for thirteen hours.
 */

describe('installing an update', () => {
  it('MANDATORY: never while the game is running', () => {
    expect(mayInstall({ downloaded: true, gameRunning: true })).toBe(false);
  });

  it('installs once the game is closed', () => {
    expect(mayInstall({ downloaded: true, gameRunning: false })).toBe(true);
  });

  it('does nothing before anything has downloaded', () => {
    expect(mayInstall({ downloaded: false, gameRunning: false })).toBe(false);
    expect(mayInstall({ downloaded: false, gameRunning: true })).toBe(false);
  });
});

describe('the cadence', () => {
  it('checks hourly rather than constantly', () => {
    // A squadron companion is not a browser. Hourly is well inside "members are on the current
    // build within a day" and nowhere near often enough to be noticed.
    expect(UPDATE_CHECK_MS).toBe(60 * 60_000);
  });

  it('re-checks for a closed game far more often than it checks for updates', () => {
    /*
     * Once an update is waiting, the only question left is "have they stopped playing" — and
     * answering that hourly would leave somebody on the old build for most of an evening after
     * they had already quit.
     */
    expect(INSTALL_RETRY_MS).toBeLessThan(UPDATE_CHECK_MS);
  });
});

/**
 * Installing mid-session, and the warning that has to come first.
 *
 * ★ SQUADRON OWNER, 2026-08-05 ★
 *
 * Asked whether an update could be forced through while somebody is playing, and chose to tie the
 * floor to the PUBLISHED version — every release installs, not only ones marked critical — with a
 * countdown rather than silence.
 *
 * The reason is data. v0.5.1 fixed how the app RECORDS things: journal offsets that sent a member's
 * history to the wrong hub, and a carrier hold that only ever climbed. A member in a twelve-hour
 * session is exactly the one whose data is wrong, and exactly the one the old rule never reached —
 * it waited for a game close that might be a week away.
 *
 * The cost is real and was accepted knowingly: every update now interrupts play. Sixty seconds is
 * the mitigation, and the rule below is what guarantees nobody is restarted without being told.
 */
describe('a downloaded update while the game is running', () => {
  const WARNED = 1_000_000;

  it('MANDATORY: does NOT install before the member has been warned', () => {
    /*
     * The whole point. A countdown that could expire against somebody who was never told is a
     * silent mid-session restart, which is what makes people uninstall a background app.
     */
    expect(
      mayInstall({ downloaded: true, gameRunning: true, warnedAt: null, now: WARNED }),
    ).toBe(false);
  });

  it('MANDATORY: does not install while the countdown is still running', () => {
    expect(
      mayInstall({
        downloaded: true,
        gameRunning: true,
        warnedAt: WARNED,
        now: WARNED + FORCED_INSTALL_GRACE_MS - 1,
      }),
    ).toBe(false);
  });

  it('MANDATORY: installs once the countdown has elapsed, game or no game', () => {
    expect(
      mayInstall({
        downloaded: true,
        gameRunning: true,
        warnedAt: WARNED,
        now: WARNED + FORCED_INSTALL_GRACE_MS,
      }),
    ).toBe(true);
  });

  it('a closed game still installs at once, with no warning and no wait', () => {
    // There is no interruption to warn about, so making them wait sixty seconds would be delay
    // for its own sake.
    expect(mayInstall({ downloaded: true, gameRunning: false, warnedAt: null })).toBe(true);
  });

  it('nothing installs before it has downloaded', () => {
    expect(
      mayInstall({
        downloaded: false,
        gameRunning: false,
        warnedAt: WARNED,
        now: WARNED + FORCED_INSTALL_GRACE_MS * 10,
      }),
    ).toBe(false);
  });

  it('the retry tick is faster than the countdown, or a minute takes two', () => {
    /*
     * Polling every sixty seconds for a sixty-second countdown means it fires anywhere between one
     * and two minutes after the warning. A member told "about a minute" should get about a minute.
     */
    expect(FORCED_INSTALL_TICK_MS).toBeLessThan(FORCED_INSTALL_GRACE_MS);
  });

  it('the grace period is long enough to dock and short enough to land', () => {
    // Sanity bounds rather than a restatement of the constant: half a minute is not enough to
    // finish a docking sequence, and five would mean the update never lands on a busy evening.
    expect(FORCED_INSTALL_GRACE_MS).toBeGreaterThanOrEqual(30_000);
    expect(FORCED_INSTALL_GRACE_MS).toBeLessThanOrEqual(180_000);
  });
});
