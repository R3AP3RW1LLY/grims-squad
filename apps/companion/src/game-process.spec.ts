import { describe, it, expect } from 'vitest';
import {
  commandFor,
  listingHasGame,
  isGameRunning,
  isActivelyPlaying,
  journalIsFresh,
  statusSaysInGame,
  GAME_PROCESS,
  JOURNAL_FRESH_MS,
  STATUS_FRESH_MS,
} from './game-process.js';

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

describe('in-game, not merely open', () => {
  /*
   * ★ THE REPORT THIS ANSWERS ★
   *
   * "still showing me playing now on the roster when I've quit the game" — and
   * the process check was RIGHT: EliteDangerous64.exe was genuinely running.
   * Elite keeps it alive at the main menu, at commander select, and for anyone
   * who leaves it open and walks away.
   *
   * Squadron owner's decision, 2026-07-29: presence means in-game.
   */
  const NOW = new Date('2026-07-29T12:00:00Z').getTime();
  const ago = (ms: number) => NOW - ms;
  const MIN = 60_000;

  it('MANDATORY: the process alone is NOT playing', () => {
    // The exact case reported: game open at a menu, journal long quiet.
    expect(isActivelyPlaying(true, ago(40 * MIN), NOW)).toBe(false);
  });

  it('MANDATORY: a fresh journal alone is NOT playing', () => {
    /*
     * The other half. Straight after quitting, the last write is still recent —
     * treating that as live is precisely the five-minute lag members notice.
     */
    expect(isActivelyPlaying(false, ago(1 * MIN), NOW)).toBe(false);
  });

  it('MANDATORY: both together IS playing', () => {
    expect(isActivelyPlaying(true, ago(2 * MIN), NOW)).toBe(true);
  });

  it('MANDATORY: survives a quiet stretch mid-flight', () => {
    /*
     * Elite writes nothing during long supercruise. A short window would blink
     * somebody offline mid-jump — the very failure the process check was added
     * to fix, reintroduced from the other side.
     */
    expect(isActivelyPlaying(true, ago(14 * MIN), NOW)).toBe(true);
    expect(isActivelyPlaying(true, ago(16 * MIN), NOW)).toBe(false);
    expect(JOURNAL_FRESH_MS).toBe(15 * MIN);
  });

  it('treats no journal at all as not playing', () => {
    expect(isActivelyPlaying(true, null, NOW)).toBe(false);
  });

  it('MANDATORY: a file stamped in the future is a clock problem, not a session', () => {
    // Otherwise a skewed clock pins somebody online permanently and nothing
    // ever clears it.
    expect(journalIsFresh(NOW + 60 * MIN, NOW)).toBe(false);
  });
});

/**
 * Status.json's half of the answer — the signal that ended the false-offline.
 *
 * Reported live, 2026-08-04: a member hauling a full hold, Status.json 0.2 seconds old, shown
 * "Elite is not running" because the journal had been quiet past the fifteen-minute window.
 */
describe('statusSaysInGame', () => {
  const now = 1_000_000_000;

  it('MANDATORY: a fresh file with live flags is in-game — the quiet-journal session', () => {
    expect(statusSaysInGame(now - 5_000, 689963032, 0, now)).toBe(true);
  });

  it('the main menu — fresh file, zero flags — is open, not in', () => {
    expect(statusSaysInGame(now - 5_000, 0, 0, now)).toBe(false);
  });

  it('on foot counts: Flags 0 but Flags2 live is Odyssey walking around', () => {
    expect(statusSaysInGame(now - 5_000, 0, 90113, now)).toBe(true);
  });

  it('a stale file is a session that ended, whatever its flags say', () => {
    expect(statusSaysInGame(now - STATUS_FRESH_MS, 689963032, 0, now)).toBe(false);
  });

  it('a file stamped in the future is a clock problem, not a live session', () => {
    expect(statusSaysInGame(now + 60_000, 689963032, 0, now)).toBe(false);
  });

  it('no file at all is no evidence', () => {
    expect(statusSaysInGame(null, 689963032, 0, now)).toBe(false);
  });
});

describe('isActivelyPlaying with the status sidecar', () => {
  const now = 1_000_000_000;

  it('MANDATORY: process + live status carries a quiet journal — the outfitting session', () => {
    expect(isActivelyPlaying(true, now - JOURNAL_FRESH_MS - 1, now, true)).toBe(true);
  });

  it('status evidence without the process is still a session that ended', () => {
    expect(isActivelyPlaying(false, null, now, true)).toBe(false);
  });

  it('the old contract stands: process + fresh journal needs no sidecar', () => {
    expect(isActivelyPlaying(true, now - 1_000, now)).toBe(true);
  });
});
