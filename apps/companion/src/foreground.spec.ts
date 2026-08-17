import { describe, expect, it, vi } from 'vitest';
import { foregroundWindow, overlaysShouldShow } from './foreground.js';
import { commandForPid, isPidGame } from './game-process.js';

/**
 * Whether the overlays should be on screen.
 *
 * ★ THE RULE IS THE WHOLE FEATURE ★
 *
 * Everything else here is three Win32 calls that cannot be unit tested on a build machine. The
 * decision they feed is pure, and it has three cases that each break the app in a different way if
 * they are wrong — so those are what is pinned.
 */

/**
 * Shorthand. Every case states only what it is about; the rest is "playing normally".
 */
function show(over: Partial<Parameters<typeof overlaysShouldShow>[0]>) {
  return overlaysShouldShow({
    gameRunning: true,
    gameIsForeground: true,
    ourWindowFocused: false,
    ourWindowMinimised: false,
    editing: false,
    ...over,
  });
}

describe('when the overlays are on screen', () => {
  it('shows everything while the game is in front', () => {
    expect(show({})).toEqual({ overGame: true, detached: true });
  });

  it('hides the over-game panels when something else is in front', () => {
    // The first report: minimise the game and the panels stay up over the desktop.
    expect(show({ gameIsForeground: false })).toEqual({ overGame: false, detached: true });
  });

  it('HIDES EVERYTHING when the game is not running at all', () => {
    /*
     * ★ THE CASE THE FIRST VERSION MISSED — SQUADRON OWNER, 2026-08-03 ★
     *
     * "the overlays still appear even if the game is not open at all if the launcher is open!"
     *
     * The gate only covered `over-game` panels, on the reasoning that a detached one was a
     * deliberate second-monitor choice. But `destinationFor()` FORCES every panel to detached in
     * exclusive fullscreen and whenever DisplaySettings.xml cannot be read — so for anybody in
     * fullscreen, nothing was gated and the feature did nothing whatsoever.
     */
    expect(show({ gameRunning: false, gameIsForeground: false })).toEqual({
      overGame: false,
      detached: false,
    });
  });

  it('hides everything with the launcher in front and no game running', () => {
    // Exactly the reported scenario. EDLaunch.exe is not the game — `isPidGame` rejects it — so the
    // foreground is not Elite AND nothing is running.
    expect(show({ gameRunning: false, gameIsForeground: false })).toEqual({
      overGame: false,
      detached: false,
    });
  });

  it('keeps a detached panel up while the game runs behind a browser', () => {
    // A second-monitor panel is still worth reading while somebody alt-tabs to look something up.
    // Only the ones drawn OVER the game have to go.
    expect(show({ gameRunning: true, gameIsForeground: false })).toEqual({
      overGame: false,
      detached: true,
    });
  });

  it('KEEPS THEM UP while our own window has focus', () => {
    /*
     * The term everybody forgets, and the one SrvSurvey gets right: `focusElite || focusSrvSurvey`.
     * Without it, clicking the companion window to arrange your panels makes every panel you are
     * trying to drag disappear — the feature destroying the only workflow that needs it.
     */
    expect(show({ gameRunning: false, gameIsForeground: false, ourWindowFocused: true })).toEqual({
      overGame: true,
      detached: true,
    });
  });

  it('keeps them up in arrange mode whatever else is true', () => {
    expect(show({ gameRunning: false, gameIsForeground: false, editing: true })).toEqual({
      overGame: true,
      detached: true,
    });
  });

  it('leaves them up when it cannot tell', () => {
    /*
     * ★ FAILS OPEN, DELIBERATELY ★
     *
     * Null is "no native binding", or no foreground window at all during a desktop switch or a lock
     * screen. A member whose overlays stop hiding has a small annoyance; a member whose overlays
     * vanish for good has a broken app and no way to find out why.
     */
    expect(show({ gameRunning: null, gameIsForeground: null })).toEqual({
      overGame: true,
      detached: true,
    });
  });
});

describe('reading the foreground window', () => {
  it('answers null on anything that is not Windows', () => {
    // Elite does not run natively on either, and there is no user32 to ask.
    expect(foregroundWindow('darwin')).toBeNull();
    expect(foregroundWindow('linux')).toBeNull();
  });
});

describe('asking whether a process id is the game', () => {
  it('filters by PID, not by image name', () => {
    /*
     * The distinction matters: "is the game running somewhere" is already answered elsewhere. This
     * one asks whether THAT window's owner is the game, which is what decides visibility.
     */
    expect(commandForPid('win32', 4242)).toEqual({
      command: 'tasklist',
      args: ['/FI', 'PID eq 4242', '/NH', '/FO', 'CSV'],
    });
    expect(commandForPid('darwin', 4242)).toBeNull();
  });

  it('recognises the game', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: '"EliteDangerous64.exe","4242","Console","1","2,097,152 K"\r\n' });

    await expect(isPidGame(4242, 'win32', run)).resolves.toBe(true);
  });

  it('refuses the LAUNCHER, which is not the game', async () => {
    // Panels drawn over the launcher would be wrong, and the launcher is what is in front for the
    // first minute of every session.
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: '"EDLaunch.exe","4242","Console","1","40,000 K"\r\n' });

    await expect(isPidGame(4242, 'win32', run)).resolves.toBe(false);
  });

  it('says no rather than throwing when the lookup fails', async () => {
    // A wedged or missing `tasklist` must not take the overlay runtime's tick with it.
    const run = vi.fn().mockRejectedValue(new Error('timed out'));
    await expect(isPidGame(4242, 'win32', run)).resolves.toBe(false);
  });
});

/**
 * Minimising the app must not hide the overlays.
 *
 * ★ SQUADRON OWNER, 2026-08-17 ★
 *
 * "the overlay keeps disappearing when we minimize the companion app, this should be visible if the
 * game window is open"
 *
 * Minimising removed the `ourWindowFocused` override, and what the rule fell through to asks whether
 * the GAME is the foreground window. Straight after a minimise it often is not — the desktop or
 * whatever sat behind takes focus first — so every panel vanished at the exact moment the member had
 * cleared the screen to look at them.
 */
describe('the app tucked out of the way', () => {
  it('★ MANDATORY: minimising the app keeps the overlays up ★', () => {
    expect(
      show({ ourWindowMinimised: true, gameIsForeground: false, ourWindowFocused: false }),
    ).toEqual({ overGame: true, detached: true });
  });

  it('★ MANDATORY: but a game that is not running still hides them ★', () => {
    // Minimising the app is not a reason to draw panels over a desktop with no Elite on it.
    expect(
      show({ ourWindowMinimised: true, gameRunning: false, gameIsForeground: false }),
    ).toEqual({ overGame: false, detached: false });
  });

  it('★ MANDATORY: merely UNFOCUSED is not minimised ★', () => {
    /*
     * The distinction is the whole point. Clicking a browser leaves our window unfocused, and
     * treating that the same would put panels over the browser — which is the complaint the
     * foreground rule was written to fix. Minimising is a deliberate act; losing focus is not.
     */
    expect(
      show({ ourWindowMinimised: false, ourWindowFocused: false, gameIsForeground: false }),
    ).toEqual({ overGame: false, detached: true });
  });
});
