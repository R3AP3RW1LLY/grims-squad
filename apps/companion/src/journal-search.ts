import { isJournalFile } from '@grims/shared';

/**
 * Finding the journals when the usual places do not have them.
 *
 * ★ WHY A SEARCH AND NOT JUST A LIST ★
 *
 * The known paths cover a normal install, and they miss a great many real ones:
 * a Steam library on a second drive, a Proton prefix under a non-default Steam
 * root, a CrossOver bottle somebody renamed, OneDrive having quietly moved
 * Saved Games, a Windows install where the user folder is on D:.
 *
 * Every one of those ends with a member being asked to find a folder they have
 * never heard of, inside a prefix that only exists because the game does not
 * run natively. Most will not, and the honest outcome of "point the app at your
 * journals" for a non-technical player is that they close it.
 *
 * ★ BOUNDED, BECAUSE A NAIVE SCAN IS WORSE THAN NO SCAN ★
 *
 * Walking a whole disk on a machine with a few million files takes minutes and
 * pins a core. Three limits keep it honest:
 *
 *   - DEPTH. The folder is always at a known depth below a plausible root, so
 *     nothing needs to descend forever.
 *   - A DEADLINE. The search stops when time is up and reports what it found,
 *     rather than running until it finishes.
 *   - A SKIP LIST. node_modules, .git, Windows, and the rest of the places the
 *     game demonstrably is not.
 *
 * It runs ONCE, when the known paths come up empty, and the answer is saved.
 */

export interface SearchFs {
  readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

/** The folder Frontier writes journals into, identical inside every Wine prefix. */
const TARGET = 'Elite Dangerous';
const TARGET_PARENT = 'Frontier Developments';

/**
 * How deep to go below a root.
 *
 * A Proton prefix is the worst case, and the deepest real layout is roughly:
 *   steamapps/compatdata/359320/pfx/drive_c/users/steamuser/Saved Games/
 *   Frontier Developments/Elite Dangerous
 * which is ten. Twelve leaves room for a library folder or two without opening
 * the door to a full-disk walk.
 */
export const MAX_DEPTH = 12;

/** Folders that cannot contain a game install, and cost a lot to walk. */
const SKIP = new Set([
  'node_modules',
  '.git',
  '.cache',
  'AppData',
  'Windows',
  'System Volume Information',
  '$Recycle.Bin',
  'ProgramData',
  'proc',
  'sys',
  'dev',
  'snap',
  '.local',
  'Library',
  'System',
  'private',
]);

export interface SearchResult {
  /** Every folder found holding journals, most promising first. */
  readonly found: string[];
  /** True when the deadline stopped us before the search was exhausted. */
  readonly timedOut: boolean;
}

/**
 * Searches for a folder containing Elite journals.
 *
 * Breadth-first, so the shallow and likely candidates are checked before the
 * deep and unlikely ones — which matters a great deal when a deadline may cut
 * the search short.
 */
export async function searchForJournalDir(
  fs: SearchFs,
  roots: readonly string[],
  options: { deadlineMs?: number; now?: () => number; maxDepth?: number } = {},
): Promise<SearchResult> {
  const now = options.now ?? (() => Date.now());
  const deadline = now() + (options.deadlineMs ?? 20_000);
  const maxDepth = options.maxDepth ?? MAX_DEPTH;

  const found: string[] = [];
  const seen = new Set<string>();
  let queue: Array<{ path: string; depth: number }> = roots.map((path) => ({ path, depth: 0 }));

  while (queue.length > 0) {
    if (now() >= deadline) return { found: rank(found), timedOut: true };

    const next: Array<{ path: string; depth: number }> = [];

    for (const { path, depth } of queue) {
      if (now() >= deadline) return { found: rank(found), timedOut: true };
      if (seen.has(path)) continue;
      seen.add(path);

      const entries = await fs.readDir(path).catch(() => null);
      // Unreadable is the common case, not an error: a permissions-denied
      // system folder is exactly the sort of place we are walking past.
      if (entries === null) continue;

      // A folder holding journal FILES is the answer, whatever it is called.
      // Checking the contents rather than the name is what makes a renamed
      // bottle or a relocated Saved Games folder findable at all.
      if (entries.some((e) => !e.isDirectory && isJournalFile(e.name))) {
        found.push(path);
        // Not descending further: journals do not nest inside journals, and
        // the folder we want is this one.
        continue;
      }

      if (depth >= maxDepth) continue;

      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        if (SKIP.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.steam' && entry.name !== '.wine') continue;
        next.push({ path: `${path}/${entry.name}`, depth: depth + 1 });
      }
    }

    queue = next;
  }

  return { found: rank(found), timedOut: false };
}

/**
 * Most promising first.
 *
 * A machine can genuinely hold several: a live install, an old Proton prefix
 * from before somebody switched to native, a copy restored from a backup. The
 * one under the expected Frontier folder is almost certainly the real one, and
 * a shallower path beats a deeper one because prefixes and backups sit deep.
 */
function rank(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((a, b) => {
    const score = (p: string) =>
      (p.includes(TARGET_PARENT) ? 0 : 2) + (p.endsWith(TARGET) ? 0 : 1);
    const byScore = score(a) - score(b);
    if (byScore !== 0) return byScore;

    const byDepth = a.split('/').length - b.split('/').length;
    return byDepth !== 0 ? byDepth : a.localeCompare(b);
  });
}

/**
 * Where to start looking, per platform.
 *
 * Not "/" — a search from the filesystem root is a search of everything, and on
 * Windows it would walk the recycle bin and every restore point before reaching
 * anywhere useful. These are the places a game install can actually be.
 */
export function searchRootsFor(ctx: {
  platform: 'win32' | 'darwin' | 'linux';
  home: string;
  drives?: readonly string[] | undefined;
}): string[] {
  const home = ctx.home.replace(/[\\/]+$/, '').replace(/\\/g, '/');

  switch (ctx.platform) {
    case 'win32':
      return [
        `${home}/Saved Games`,
        `${home}/OneDrive`,
        `${home}/Documents`,
        // Every fixed drive. A Steam library on D: is completely normal, and it
        // is the single most common reason the known paths miss.
        ...(ctx.drives ?? ['C:']).flatMap((d) => [
          `${d}/SteamLibrary`,
          `${d}/Program Files (x86)/Steam`,
          `${d}/Games`,
          `${d}/Epic Games`,
        ]),
      ];

    case 'darwin':
      return [
        // CrossOver and Whisky bottles. The game is not native here — these are
        // Wine prefixes with a Windows filesystem inside them.
        `${home}/Library/Application Support/CrossOver/Bottles`,
        `${home}/Library/Containers/com.isaacmarovitz.Whisky/Bottles`,
        `${home}/Library/Application Support/Whisky/Bottles`,
        `${home}/Wine`,
      ];

    case 'linux':
      return [
        `${home}/.steam/steam/steamapps/compatdata`,
        `${home}/.local/share/Steam/steamapps/compatdata`,
        `${home}/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata`,
        `${home}/.wine`,
        // A second-drive Steam library, which is as common on Linux as anywhere.
        '/mnt',
        '/media',
      ];
  }
}
