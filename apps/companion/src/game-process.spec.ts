import { describe, it, expect } from 'vitest';
import { commandFor, listingHasGame, isGameRunning, GAME_PROCESS } from './game-process.js';

/**
 * Is the game running?
 *
 * ★ THE BUG THIS EXISTS FOR ★
 *
 * Presence used to mean "the newest journal grew during this pass". Reported
 * from a live machine on 2026-07-28: EliteDangerous64.exe resident at 3.2 GB,
 * journal untouched for twenty-six minutes, Status.json for thirty-two — and
 * the member shown as offline while sitting in the game.
 *
 * Outfitting, the galaxy map, a station menu and a parked ship all write
 * nothing. The journal going quiet is not the member leaving.
 */

describe('finding the game in a process listing', () => {
  it('MANDATORY: finds the real Windows process name', () => {
    expect(listingHasGame('"EliteDangerous64.exe","58736","Console","1","3,290,896 K"')).toBe(true);
  });

  it('MANDATORY: the LAUNCHER is not the game', () => {
    /*
     * `EDLaunch.exe` sits resident after the game closes, and for many members
     * starts with Windows. Counting it would show half the squadron as in-game
     * permanently — and an indicator that is always on carries no information
     * at all.
     */
    expect(listingHasGame('"EDLaunch.exe","60128","Console","1","397,020 K"')).toBe(false);
  });

  it('MANDATORY: finds the game even when the launcher is also running', () => {
    // The normal case: both are up. This is the exact listing from the machine
    // that reported the bug.
    const real = [
      'Elite Dangerous Explorati    15792 Console                    1    826,856 K',
      'EDLaunch.exe                 60128 Console                    1    397,020 K',
      'EliteDangerous64.exe         58736 Console                    1  3,290,896 K',
    ].join('\n');

    expect(listingHasGame(real)).toBe(true);
  });

  it('reads a full Unix listing, as Proton and CrossOver report it', () => {
    // Wine keeps the Windows executable name, which is why one name works on
    // all three platforms.
    const ps = ['/usr/lib/systemd/systemd', 'wineserver', 'EliteDangerous64.exe', 'bash'].join('\n');
    expect(listingHasGame(ps)).toBe(true);
  });

  it('is not fooled by an empty or "no tasks" listing', () => {
    expect(listingHasGame('')).toBe(false);
    expect(listingHasGame('INFO: No tasks are running which match the specified criteria.')).toBe(
      false,
    );
  });

  it('matches regardless of case', () => {
    expect(listingHasGame('elitedangerous64.exe')).toBe(true);
  });
});

describe('the command per platform', () => {
  it('filters in Windows rather than reading every process', () => {
    const cmd = commandFor('win32');
    expect(cmd?.command).toBe('tasklist');
    expect(cmd?.args).toContain(`IMAGENAME eq ${GAME_PROCESS}`);
    // No header row to parse, and quoted fields so a name with a space in it
    // cannot be misread.
    expect(cmd?.args).toContain('/NH');
  });

  it('reads the whole listing on macOS and Linux', () => {
    for (const p of ['darwin', 'linux'] as const) {
      expect(commandFor(p)?.command).toBe('ps');
    }
  });

  it('MANDATORY: asks nothing on a platform Elite cannot run on', () => {
    // No native build and no Wine story — there is nothing to look for, and
    // spawning a process every twenty seconds to prove it would be waste.
    expect(commandFor('aix')).toBeNull();
    expect(commandFor('sunos')).toBeNull();
  });
});

describe('when the lookup fails', () => {
  it('MANDATORY: reports NOT running, never running', async () => {
    /*
     * Missing binary, blocked by policy, timed out — all mean we do not know.
     * Claiming somebody is in-game when we cannot tell would put a green dot
     * beside a member who is asleep, and the journal-growth signal still runs
     * alongside this for anyone actually playing.
     */
    const throwing = async () => {
      throw new Error('tasklist: not found');
    };
    expect(await isGameRunning('win32', throwing)).toBe(false);
  });

  it('does not run a command on an unsupported platform', async () => {
    let called = false;
    await isGameRunning('aix', async () => {
      called = true;
      return { stdout: 'EliteDangerous64.exe' };
    });
    expect(called).toBe(false);
  });

  it('reports running when the listing has it', async () => {
    const ok = async () => ({ stdout: '"EliteDangerous64.exe","1","Console","1","3 K"' });
    expect(await isGameRunning('win32', ok)).toBe(true);
  });
});
