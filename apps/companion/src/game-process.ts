/**
 * Is Elite actually running?
 *
 * ★ THE BUG THIS FIXES ★
 *
 * Presence used to mean "the newest journal grew during this pass". That is a
 * real signal, but it is not the question — a commander sitting in outfitting,
 * reading the galaxy map, running a station menu or simply parked at a landing
 * pad writes NOTHING for half an hour at a time.
 *
 * Reported from a live machine, 2026-07-28: `EliteDangerous64.exe` resident at
 * 3.2 GB, journal untouched for twenty-six minutes, `Status.json` for
 * thirty-two. The app was working exactly as written and the member was shown
 * as offline while sitting in the game.
 *
 * The process is the honest answer. It cannot be idle-quiet, it cannot be
 * mid-flight-quiet, and it goes away the moment the game does.
 *
 * ★ ONE EXECUTABLE NAME, ALL THREE PLATFORMS ★
 *
 * Elite has no native Mac or Linux build. Both run the Windows binary under
 * Proton, CrossOver or Whisky, and the process keeps the name
 * `EliteDangerous64.exe` in every one of them — so a single name works
 * everywhere, and the per-platform part is only how you ask for the list.
 */

/** Runs a command and returns stdout. Injected so this is testable. */
export type ProcessLister = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: string }>;

/**
 * The game's executable.
 *
 * Matched case-insensitively as a SUBSTRING of the process list, not by
 * equality: Windows truncates long names in some views, Wine decorates them,
 * and `ps -A -o comm=` yields a full path under Proton. All of them contain
 * this.
 */
export const GAME_PROCESS = 'EliteDangerous64.exe';

/**
 * The launcher, which is emphatically NOT the game.
 *
 * `EDLaunch.exe` sits resident after the game closes and for many members
 * starts with Windows. Treating it as "playing" would show half the squadron
 * as in-game permanently, which is worse than showing nobody — a presence
 * indicator that is always on carries no information at all.
 */
export const NOT_THE_GAME = ['edlaunch.exe'];

export function commandFor(
  platform: NodeJS.Platform,
): { command: string; args: readonly string[] } | null {
  if (platform === 'win32') {
    /*
     * `/NH` drops the header row, `/FO CSV` quotes fields so a process with a
     * space in its name cannot be misread. Filtering here rather than in JS
     * means Windows does the work and we parse a line or two.
     */
    return {
      command: 'tasklist',
      args: ['/FI', `IMAGENAME eq ${GAME_PROCESS}`, '/NH', '/FO', 'CSV'],
    };
  }

  if (platform === 'darwin' || platform === 'linux') {
    // `-A` every process, `-o comm=` the command with no header. Wine reports
    // the Windows executable name here.
    return { command: 'ps', args: ['-A', '-o', 'comm='] };
  }

  // Elite cannot be running on anything else, so there is nothing to look for.
  return null;
}

/**
 * Reads a process listing and decides whether the game is in it.
 *
 * Separated from running the command so every awkward case — the "no tasks"
 * message, the launcher, a truncated name — is testable without a machine that
 * happens to be playing Elite.
 */
export function listingHasGame(stdout: string): boolean {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '')
    .some((line) => {
      /*
       * ★ THE LAUNCHER IS EXCLUDED FIRST ★
       *
       * It is checked before the match rather than after, because on Windows
       * the filtered `tasklist` only ever returns the game — but on Linux and
       * macOS we read the WHOLE process list, and there both binaries appear.
       */
      if (NOT_THE_GAME.some((n) => line.includes(n))) return false;
      return line.includes(GAME_PROCESS.toLowerCase());
    });
}

/**
 * Whether the game is running now.
 *
 * ★ FAILS TO `false`, AND THAT IS THE SAFE DIRECTION ★
 *
 * If the command is missing, blocked by policy or times out, we do not know —
 * and claiming somebody is in-game when we cannot tell would put a green dot
 * beside a member who is asleep. The journal-growth signal still runs
 * alongside this, so a member who is actually playing and writing events is
 * still seen.
 */
export async function isGameRunning(
  platform: NodeJS.Platform,
  run: ProcessLister,
): Promise<boolean> {
  const cmd = commandFor(platform);
  if (cmd === null) return false;

  try {
    const { stdout } = await run(cmd.command, cmd.args);
    return listingHasGame(stdout);
  } catch {
    return false;
  }
}

/**
 * How stale the journal may be before "playing" becomes a lie.
 *
 * ★ THE PROCESS BEING UP IS NOT THE SAME AS PLAYING ★
 *
 * Reported from a real machine: the member had quit and the roster still said
 * "Playing now" — and the detection was RIGHT, because `EliteDangerous64.exe`
 * was genuinely still running. Elite keeps the process alive at the main menu,
 * at commander select, and for anybody who leaves it open and walks away.
 *
 * So presence is the process AND a journal that has been written recently.
 * Fifteen minutes, because the journal falls quiet during long supercruise and
 * a shorter window would blink somebody offline mid-flight — the exact failure
 * the process check was added to fix.
 *
 * Squadron owner's decision, 2026-07-29: in-game, not merely open.
 */
export const JOURNAL_FRESH_MS = 15 * 60_000;

/** Is the newest journal recent enough to call this an active session? */
export function journalIsFresh(newestWriteAt: number | null, now: number = Date.now()): boolean {
  if (newestWriteAt === null) return false;
  const age = now - newestWriteAt;
  // A file stamped in the future is a clock problem, not a live session.
  return age >= 0 && age < JOURNAL_FRESH_MS;
}

/**
 * Both halves. Neither alone is enough.
 *
 * Process without a fresh journal is the game sitting at a menu. A fresh
 * journal without the process is a session that has just ended — the last write
 * is still recent, and reporting that as live is exactly the lag members notice
 * when they quit.
 */
export function isActivelyPlaying(
  processRunning: boolean,
  newestWriteAt: number | null,
  now: number = Date.now(),
): boolean {
  return processRunning && journalIsFresh(newestWriteAt, now);
}
