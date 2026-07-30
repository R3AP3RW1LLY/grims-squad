import { describe, it, expect } from 'vitest';
import { INSTALL_RETRY_MS, UPDATE_CHECK_MS, mayInstall } from './auto-update.js';

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
