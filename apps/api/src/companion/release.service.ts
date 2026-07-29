import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

/**
 * The companion app's installers.
 *
 * ★ THE BUILD LIVES IN OBJECT STORAGE, NOT IN GIT AND NOT ON GITHUB ★
 *
 * Squadron owner's decision, 2026-07-28. CI builds the installers and uploads
 * them to the Vultr bucket; this reads what is there and the members' page
 * links to it.
 *
 * Not GitHub releases: that page asks a member to pick the right file out of a
 * list that also holds blockmaps, checksums and source archives, and puts a
 * developer-facing site in the middle of somebody's first five minutes.
 *
 * Not the repository either — the Windows installer alone is ~100 MB, and a
 * committed `release/` directory has already broken a push once.
 *
 * ★ ONE VERSION AT A TIME ★
 *
 * CI deletes older objects after uploading a new one, so the bucket holds
 * exactly the current build. That is enforced at the WRITE, where there is one
 * writer, rather than here — a reader that hides old versions still pays to
 * store them, and "the bucket is the current release" is a far simpler thing to
 * reason about than "the bucket is every release and the API picks".
 *
 * This still sorts newest-first, because a failed prune must not leave members
 * downloading last month's build.
 */

/** Where installers live in the bucket. Everything else there is not ours. */
export const RELEASE_PREFIX = 'companion/';

/** One installer, as offered to a member. */
export interface ReleaseAsset {
  /** The object key's basename. Used as the download id — see the traversal note. */
  readonly file: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly version: string | null;
  readonly sizeBytes: number;
  readonly builtAt: string;
}

/**
 * What a member downloads, and what they do not.
 *
 * `.blockmap` is electron-builder's differential-update index, `.yml` its
 * update manifest, and `builder-debug.yml` build diagnostics. All three sit
 * beside the installer and none is a thing anybody should click.
 */
const INSTALLER_EXTENSIONS = new Set(['.exe', '.dmg', '.appimage', '.deb', '.rpm', '.zip']);

export function platformOf(file: string): ReleaseAsset['platform'] | null {
  const ext = extname(file).toLowerCase();
  if (ext === '.exe') return 'windows';
  if (ext === '.dmg') return 'macos';
  if (ext === '.appimage' || ext === '.deb' || ext === '.rpm') return 'linux';

  /*
   * A .zip could be any of them, so the NAME decides. Guessing wrong would
   * offer a Mac build to a Windows player, which fails in a way that looks like
   * a broken download rather than a wrong file.
   */
  if (ext === '.zip') {
    const lower = file.toLowerCase();
    if (lower.includes('mac') || lower.includes('darwin')) return 'macos';
    if (lower.includes('linux')) return 'linux';
    if (lower.includes('win')) return 'windows';
  }

  return null;
}

/** `Grims Squad Companion Setup 0.1.0.exe` -> `0.1.0`. */
export function versionOf(file: string): string | null {
  return /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(file)?.[1] ?? null;
}

/** True for a file we are willing to serve as an installer. */
export function isInstaller(file: string): boolean {
  return INSTALLER_EXTENSIONS.has(extname(file).toLowerCase()) && platformOf(file) !== null;
}

export interface ReleaseStore {
  list(): Promise<ReleaseAsset[]>;
  /** The bytes of one installer, streamed. Null for anything it will not serve. */
  open(file: string): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number } | null>;
}

/* -------------------------------------------------------------------------- */
/*  Object storage — production                                                */
/* -------------------------------------------------------------------------- */

/** The slice of an S3 client this needs. Kept narrow so it is trivial to fake. */
export interface ReleaseBucket {
  listPrefix(
    prefix: string,
  ): Promise<Array<{ key: string; sizeBytes: number; modifiedAt: Date }>>;
  openObject(key: string): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number } | null>;
}

export class BucketReleaseStore implements ReleaseStore {
  constructor(private readonly bucket: ReleaseBucket) {}

  async list(): Promise<ReleaseAsset[]> {
    let objects: Array<{ key: string; sizeBytes: number; modifiedAt: Date }>;
    try {
      objects = await this.bucket.listPrefix(RELEASE_PREFIX);
    } catch {
      /*
       * Bucket unreachable, or not configured. An empty list is the honest
       * answer and the page says "not available yet"; throwing would render as
       * "could not load your devices" for a situation that has nothing to do
       * with the member's devices.
       */
      return [];
    }

    const assets: ReleaseAsset[] = [];
    for (const o of objects) {
      const file = basename(o.key);
      if (!isInstaller(file)) continue;

      const platform = platformOf(file);
      if (platform === null) continue;

      assets.push({
        file,
        platform,
        version: versionOf(file),
        sizeBytes: o.sizeBytes,
        builtAt: o.modifiedAt.toISOString(),
      });
    }

    // Newest first. CI prunes older builds, but a failed prune must not leave
    // members downloading last month's.
    return assets.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
  }

  async open(file: string) {
    /*
     * ★ THE FILENAME COMES FROM THE REQUEST, SO IT IS NOT TRUSTED ★
     *
     * `basename` strips any directory part, so "../../secrets" becomes
     * "secrets" before it is used, and the key is then rebuilt from OUR prefix
     * rather than from anything the caller sent. The extension allowlist runs
     * first, so even a valid key to something we did not intend to publish is
     * refused unless it looks like an installer.
     */
    const safe = basename(file);
    if (!isInstaller(safe)) return null;

    return this.bucket.openObject(`${RELEASE_PREFIX}${safe}`).catch(() => null);
  }
}

/* -------------------------------------------------------------------------- */
/*  Local disk — development                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The workspace build output, for development.
 *
 * Exists so a developer who just ran `pnpm dist:win` sees their own build on
 * the page without a bucket, credentials or an account. A download that only
 * appears once somebody has provisioned object storage is one nobody tests.
 */
export class DirectoryReleaseStore implements ReleaseStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = resolve(dir);
  }

  async list(): Promise<ReleaseAsset[]> {
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return [];
    }

    const assets: ReleaseAsset[] = [];
    for (const name of names) {
      if (!isInstaller(name)) continue;
      const platform = platformOf(name);
      if (platform === null) continue;

      try {
        const info = await stat(join(this.#dir, name));
        if (!info.isFile()) continue;
        assets.push({
          file: name,
          platform,
          version: versionOf(name),
          sizeBytes: info.size,
          builtAt: info.mtime.toISOString(),
        });
      } catch {
        // Vanished between the listing and the stat. Skipped rather than
        // failing the whole page over one file.
      }
    }

    return assets.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
  }

  async open(file: string) {
    const safe = basename(file);
    if (!isInstaller(safe)) return null;

    const full = resolve(this.#dir, safe);
    // Belt and braces: basename alone has been defeated before by encodings
    // nobody expected.
    if (!full.startsWith(this.#dir)) return null;

    try {
      const info = await stat(full);
      if (!info.isFile()) return null;
      const { createReadStream } = await import('node:fs');
      return { stream: createReadStream(full), sizeBytes: info.size };
    } catch {
      return null;
    }
  }
}

/** Where a local build lands, when no bucket is configured. */
export function releaseDirFrom(env: NodeJS.ProcessEnv): string {
  return env['COMPANION_RELEASE_DIR'] ?? resolve(process.cwd(), '../companion/release');
}

/**
 * Compares two version strings numerically, segment by segment.
 *
 * ★ NOT A STRING COMPARISON ★
 *
 * `'0.10.0' < '0.9.0'` is TRUE as strings, because '1' sorts before '9'. It is
 * the classic version bug: everything works for nine releases and then updates
 * silently stop being announced, long after anybody is watching for it.
 *
 * A pre-release suffix is ignored rather than ordered — `1.2.0-beta.1` compares
 * as `1.2.0`. Getting pre-release precedence right is a specification of its own
 * and we do not publish them.
 */
function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    ((v.trim().replace(/^v/i, '').split('-')[0]) ?? '')
      .split('.')
      .map((n) => Number.parseInt(n, 10))
      // A non-numeric segment becomes 0, not NaN — every NaN comparison is
      // false, which would make every version look equal.
      .map((n) => (Number.isFinite(n) ? n : 0));

  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    // Missing segments are 0, so `1.2` and `1.2.0` are the same version.
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The newest published version across every platform.
 *
 * ★ THE HIGHEST VERSION, NOT THE MOST RECENTLY BUILT ★
 *
 * Squadron owner, 2026-07-29: "every time we release a new build that is not
 * bumped we get the update notification and its really annoying to our members
 * please! not to mention confusing!"
 *
 * Two callers were each picking "latest" a different wrong way:
 *
 *   the app's settings poll   sorted version STRINGS descending, so with 0.10.0
 *                             and 0.9.0 both in the bucket it reported 0.9.0 —
 *                             and from the tenth release onward would have
 *                             stopped announcing updates entirely
 *
 *   the website's rail        took the most recently BUILT file, so rebuilding
 *                             an older installer, or a failed prune leaving an
 *                             old file with a newer timestamp, made a PREVIOUS
 *                             version "latest"
 *
 * One function, used by both. Across platforms rather than per platform: a
 * release publishes all three together, so a per-platform answer would be the
 * same number reached less reliably.
 *
 * Returns null when nothing is published or the bucket could not be read —
 * which reads as "no update", the only honest answer when we cannot see.
 */
export function newestVersion(assets: readonly ReleaseAsset[]): string | null {
  const versions = assets.map((a) => a.version).filter((v): v is string => v !== null && v !== '');
  if (versions.length === 0) return null;
  return versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/** The published asset carrying `newestVersion`, for its build date. */
export function newestRelease(assets: readonly ReleaseAsset[]): ReleaseAsset | null {
  const version = newestVersion(assets);
  if (version === null) return null;
  /*
   * The EARLIEST build of that version, not the latest.
   *
   * A rebuild at the same version must not move the release date — the website
   * banner is bounded by a fortnight from release, and taking the newest file
   * would restart that fortnight on every rebuild. Which is the complaint.
   */
  return (
    assets
      .filter((a) => a.version === version)
      .reduce<ReleaseAsset | null>(
        (best, a) => (best === null || a.builtAt < best.builtAt ? a : best),
        null,
      ) ?? null
  );
}
