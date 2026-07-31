import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { join, dirname } from 'node:path';

const run = promisify(execFile);

/**
 * Keeping the Coriolis checkout current.
 *
 * ★ THE PROBLEM THIS EXISTS FOR — SQUADRON OWNER, 2026-08-01 ★
 *
 * "why is this so long ... can we not do this on like a 2-3 hour schedule?"
 *
 * The schedule was weekly, which looked absurd next to everything else. Lowering it alone would
 * have changed nothing, and that is the part worth writing down: the ingest read a LOCAL FOLDER
 * that somebody had downloaded by hand. However often the job ran, it would re-read the same files
 * until a human remembered to fetch the repository again — and the training page would report each
 * of those runs as freshly trained.
 *
 * The interval was never the ceiling on freshness. The checkout was.
 *
 * ★ A CORRECTION WORTH KEEPING ★
 *
 * The first version of this note claimed the local copy was three months stale, on the strength of
 * its April file dates. It was not: GitHub archives preserve the COMMIT date as the file mtime, and
 * upstream's head commit really is from April — coriolis-data simply had not changed since. The
 * copy was exactly current.
 *
 * So this does not fix stale data that existed. It removes the DEPENDENCE on somebody noticing:
 * when Frontier next ships an update, the checkout follows within three hours instead of whenever
 * a human thinks to look.
 *
 * ★ ONE CHEAP REQUEST MOST OF THE TIME ★
 *
 * coriolis-data changes when Frontier ships a game update — a handful of times a year. Downloading
 * the repository every three hours to discover that nothing changed would be rude to somebody
 * else's server and pointless besides.
 *
 * So: ask GitHub for the head commit id, which is one small request, and compare it to the id we
 * recorded last time. Equal means stop, and the whole job costs a single round trip. Different
 * means download — a few times a year.
 */

/** Upstream. EDCD maintain this; it is the data Coriolis itself is built from. */
const REPO = 'EDCD/coriolis-data';
const BRANCH = 'master';

/** Where the recorded commit id lives, beside the checkout it describes. */
function stampPath(dir: string): string {
  return join(dirname(dir), `.coriolis-head`);
}

export interface RefreshResult {
  /** True when the checkout was replaced. False means upstream had nothing new. */
  readonly changed: boolean;
  /** The head commit now on disk, or null when we could not reach upstream. */
  readonly head: string | null;
  /** Why we did not update, when we did not. Null on success. */
  readonly skipped: string | null;
}

/**
 * Brings the checkout up to date, or reports why it could not.
 *
 * ★ NEVER THROWS PAST THE INGEST ★
 *
 * GitHub being unreachable is an ordinary state — a home connection, a rate limit, an outage. The
 * ingest must still run against whatever is already on disk, because stale ship data is enormously
 * better than none. This returns a reason instead of failing, and the caller records it.
 */
export async function refreshCoriolis(dir: string): Promise<RefreshResult> {
  let head: string;
  try {
    /*
     * The commits API returns the whole commit object; we want one field. `Accept: sha` asks GitHub
     * to return JUST the id as plain text — a few bytes rather than a few kilobytes, eight times a
     * day, of something we then throw away.
     */
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: {
        accept: 'application/vnd.github.sha',
        // GitHub refuses unidentified clients on some endpoints, and an honest name is the polite
        // thing to send to a service we are using for free.
        'user-agent': 'GrimsSquadHub (knowledge ingest)',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { changed: false, head: null, skipped: `GitHub answered ${res.status}` };
    head = (await res.text()).trim();
  } catch (e) {
    return {
      changed: false,
      head: null,
      skipped: `could not reach GitHub (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  if (!/^[0-9a-f]{40}$/.test(head)) {
    return { changed: false, head: null, skipped: 'GitHub returned something that is not a commit id' };
  }

  const stamp = stampPath(dir);
  const previous = existsSync(stamp) ? (await readFile(stamp, 'utf8')).trim() : '';

  if (previous === head && existsSync(dir)) {
    // The common case, by a very large margin. One request and we are done.
    return { changed: false, head, skipped: null };
  }

  /*
   * ★ DOWNLOADED AND EXTRACTED VIA tar, NOT A LIBRARY ★
   *
   * Node has gunzip built in and no tar reader. The choice was a dependency, a hand-rolled tar
   * parser (512-byte headers, plus the GNU and PAX extensions for long paths, which coriolis-data
   * has), or the tar that already exists on every machine this runs on — Debian in the container,
   * Git Bash on the development box.
   *
   * A parser I wrote would be the only tar implementation in this project and the only one nobody
   * had tested against a real archive edge case.
   */
  /*
   * ★ EXTRACTED BESIDE THE TARGET, NOT IN THE SYSTEM TEMP DIRECTORY ★
   *
   * `os.tmpdir()` is on C: here and the knowledge store is on D:, and the swap below is a RENAME —
   * which fails across volumes with EXDEV. Observed exactly that.
   *
   * Working on the target's own volume also makes the swap atomic rather than a copy: a rename
   * within a filesystem is instant and cannot be interrupted half way, which is the property the
   * swap depends on. On the Linux container both paths are the same filesystem anyway, so this
   * costs nothing there and fixes the development machine.
   */
  const work = await mkdtemp(join(dirname(dir), '.coriolis-tmp-'));
  try {
    const tarball = join(work, 'src.tar.gz');
    const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`, {
      headers: { 'user-agent': 'GrimsSquadHub (knowledge ingest)' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { changed: false, head: null, skipped: `download answered ${res.status}` };

    await writeFile(tarball, Buffer.from(await res.arrayBuffer()));

    /*
     * ★ A BARE FILENAME WITH cwd, NEVER AN ABSOLUTE PATH ★
     *
     * Passing the full path failed on Windows with "Cannot connect to C: resolve failed". GNU tar
     * treats anything before a colon as a REMOTE HOST, so the drive letter became a hostname and it
     * tried to open a network connection to a machine called C.
     *
     * `--force-local` is the usual answer and is a GNU extension; the tar bundled with Windows is
     * bsdtar and does not reliably have it. Setting cwd and passing a bare filename leaves no colon
     * for either implementation to misread, and needs nothing platform-specific.
     */
    await run('tar', ['-xzf', 'src.tar.gz'], { cwd: work });

    /*
     * GitHub wraps everything in a single directory named `<repo>-<branch>`. Found by listing
     * rather than assumed, because that name has changed shape before and an assumption here fails
     * as "no ships found" — which reads as upstream having deleted them.
     */
    const entries = await readdir(work, { withFileTypes: true });
    const root = entries.find((e) => e.isDirectory() && e.name.startsWith('coriolis-data'));
    if (root === undefined) {
      return { changed: false, head: null, skipped: 'the archive did not contain a coriolis-data directory' };
    }

    const extracted = join(work, root.name);
    if (!existsSync(join(extracted, 'ships'))) {
      // Refuse to swap in something that is not the shape we ingest. Replacing a good checkout
      // with an empty one would take the ships out of the knowledge base on the next run.
      return { changed: false, head: null, skipped: 'the archive had no ships directory' };
    }

    /*
     * ★ SWAPPED, NOT WRITTEN OVER ★
     *
     * The old checkout moves aside, the new one takes its place, and only then is the old one
     * deleted. A crash mid-copy would otherwise leave a half-written directory that the ingest
     * would read as a partial upstream — and record as a successful import of forty ships.
     */
    const retired = `${dir}.old-${head.slice(0, 7)}`;
    if (existsSync(dir)) await rename(dir, retired);
    await rename(extracted, dir);
    await rm(retired, { recursive: true, force: true }).catch(() => undefined);

    await writeFile(stamp, head, 'utf8');
    return { changed: true, head, skipped: null };
  } catch (e) {
    return {
      changed: false,
      head: null,
      skipped: `download or extract failed (${e instanceof Error ? e.message : String(e)})`,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
