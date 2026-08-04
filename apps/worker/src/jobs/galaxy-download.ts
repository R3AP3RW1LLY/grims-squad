import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Fetching the Spansh galaxy dump, so the systems and stations ingest has something to read.
 *
 * ★ WHY THIS DID NOT EXIST, AND WHY THAT WAS A PRODUCTION OUTAGE WAITING ★
 *
 * The ingest read a file at `D:/ai/knowledge/galaxy_populated.json.gz` — a path somebody had put a
 * download at, by hand, on a Windows workstation. Three things followed from that:
 *
 *   - On the production host, which is Linux, that path cannot exist. The ingest skipped with a
 *     `console.log` and returned, writing no run row at all. The training page would have said
 *     "Never run" for ever, which reads as "nobody set this up" rather than "this is broken".
 *   - Even on the workstation, freshness had a ceiling of whenever a human last downloaded it.
 *     Running nightly could not make the data newer than the file.
 *   - Nothing said any of this out loud.
 *
 * Coriolis had exactly this problem and was fixed the same way: ask upstream, download only when
 * upstream has actually moved.
 *
 * ★ CONDITIONAL, BECAUSE IT IS 4.26 GB ★
 *
 * Spansh rebuilds nightly and serves `Last-Modified`. A HEAD request is a few hundred bytes; the
 * body is four and a quarter gigabytes. Recording what we last fetched means the daily check is
 * nearly free and the download happens once per rebuild rather than once per run.
 *
 * ★ AND IT FALLS BACK TO WHAT WE HAVE ★
 *
 * If Spansh is unreachable and a dump is already on disk, that dump is used. A day-old galaxy is
 * enormously better than no galaxy, and systems do not move.
 */

/** Spansh's nightly full dump of populated space. */
const DEFAULT_URL =
  process.env['KNOWLEDGE_GALAXY_URL'] ?? 'https://downloads.spansh.co.uk/galaxy_populated.json.gz';

/**
 * How long to allow with no bytes arriving before giving up.
 *
 * A total timeout is the wrong shape for a multi-gigabyte download — any value large enough to
 * permit a slow but healthy transfer is also large enough to hide a dead one. This measures
 * progress instead: a connection that has delivered nothing for two minutes is not slow, it is
 * gone. Without it a stalled socket would hang the job for ever, which is precisely how a run ends
 * up unfinished with no error.
 */
const IDLE_TIMEOUT_MS = 120_000;

export interface GalaxyRefresh {
  /** A new dump was downloaded. */
  readonly changed: boolean;
  /** Why we did NOT download, when we did not. Null when we did. */
  readonly skipped: string | null;
  /** Whether a usable dump is on disk now, however it got there. */
  readonly available: boolean;
  readonly bytes: number | null;
}

/** What we last fetched, kept beside the dump so the check survives a restart. */
interface Meta {
  readonly lastModified: string;
  readonly bytes: number;
}

function metaPath(file: string): string {
  return `${file}.meta`;
}

function readMeta(file: string): Meta | null {
  try {
    const raw = JSON.parse(readFileSync(metaPath(file), 'utf8')) as Partial<Meta>;
    if (typeof raw.lastModified !== 'string' || typeof raw.bytes !== 'number') return null;
    return { lastModified: raw.lastModified, bytes: raw.bytes };
  } catch {
    return null;
  }
}

/**
 * Ensures the newest dump Spansh has is the one on disk.
 *
 * Never throws: every failure is reported as `skipped` with `available` saying whether the ingest
 * can proceed anyway. A downloader that throws would abort a run that could have used yesterday's
 * copy perfectly well.
 */
export interface GalaxyDownloadOptions {
  /**
   * How long to wait for RESPONSE HEADERS. Injectable only so a test can use a real socket.
   *
   * The bug this file now guards against cannot be reproduced against a mocked `fetch` — the
   * semantics that broke it are undici's, so the only honest test is a real HTTP server that
   * answers quickly and then dribbles a body. That needs a deadline measured in milliseconds
   * rather than thirty seconds.
   */
  readonly headersTimeoutMs?: number;
  /** How long with no bytes before the transfer is declared dead. Injectable for the same reason. */
  readonly idleTimeoutMs?: number;
}

export async function refreshGalaxyDump(
  file: string,
  url = DEFAULT_URL,
  options: GalaxyDownloadOptions = {},
): Promise<GalaxyRefresh> {
  const headersTimeoutMs = options.headersTimeoutMs ?? 30_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const onDisk = existsSync(file);
  const meta = readMeta(file);

  let head: Response;
  try {
    head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(headersTimeoutMs) });
  } catch (e) {
    return {
      changed: false,
      skipped: `could not reach Spansh (${e instanceof Error ? e.message : String(e)})`,
      available: onDisk,
      bytes: null,
    };
  }

  if (!head.ok) {
    return { changed: false, skipped: `Spansh answered ${head.status}`, available: onDisk, bytes: null };
  }

  const lastModified = head.headers.get('last-modified') ?? '';
  const expected = Number(head.headers.get('content-length') ?? 0);

  /*
   * Already have it. Both conditions matter: the timestamp says upstream has not moved, and the
   * size says our copy is whole. A half-written dump from an interrupted run has the right meta
   * and the wrong length, and would otherwise be trusted for ever.
   */
  if (
    onDisk &&
    meta !== null &&
    meta.lastModified === lastModified &&
    lastModified !== '' &&
    statSync(file).size === meta.bytes
  ) {
    return { changed: false, skipped: `upstream unchanged since ${lastModified}`, available: true, bytes: meta.bytes };
  }

  // Downloaded beside the target and renamed into place, so a failure part way can never leave a
  // truncated file where the ingest expects a whole one.
  const part = `${file}.part`;
  mkdirSync(dirname(file), { recursive: true });
  rmSync(part, { force: true });

  /*
   * ★ THE TIMEOUT THAT MADE THIS JOB IMPOSSIBLE — FOUND 2026-08-04 ★
   *
   * This was `fetch(url, { signal: AbortSignal.timeout(30_000) })`, and the comment below it said
   * that timeout "covers getting the response; from here the body can legitimately take a long
   * time". That is not what the signal does. It stays armed for the WHOLE request — headers AND
   * body — so thirty seconds after the request began, the download was aborted no matter how well
   * it was going.
   *
   * The file is a multi-gigabyte gzip of populated space. It cannot arrive in thirty seconds on any
   * connection the squadron owns, so the job could not succeed, ever. It failed exactly as the
   * signal promises — "The operation was aborted due to timeout" — and the whole elaborate idle
   * watchdog below it never got the chance to do its job.
   *
   * The intent was right and only the mechanism was wrong: a total timeout IS the wrong shape for a
   * huge download. So the deadline now covers only what it was meant to cover. It is cleared the
   * moment the response headers arrive, and from there the idle watchdog is the sole authority —
   * which is the design the comment already described.
   */
  const controller = new AbortController();
  const headers = setTimeout(() => {
    controller.abort(new Error(`Spansh did not send response headers within ${headersTimeoutMs}ms`));
  }, headersTimeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    // Headers are in. Everything from here is measured by PROGRESS, not by elapsed time.
    clearTimeout(headers);

    if (!res.ok || res.body === null) {
      return { changed: false, skipped: `Spansh answered ${res.status}`, available: onDisk, bytes: null };
    }

    /*
     * The idle watchdog. A connection that has delivered nothing for two minutes is not slow, it is
     * gone — and unlike a total deadline, this cannot punish a healthy transfer for being large.
     */
    let lastByteAt = Date.now();
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', () => {
      lastByteAt = Date.now();
    });
    const watchdog = setInterval(() => {
      if (Date.now() - lastByteAt > idleTimeoutMs) {
        source.destroy(new Error(`no data for ${idleTimeoutMs / 1000}s`));
      }
    }, Math.max(10, idleTimeoutMs / 4));

    try {
      await pipeline(source, createWriteStream(part));
    } finally {
      clearInterval(watchdog);
    }

    const got = statSync(part).size;
    if (expected > 0 && got !== expected) {
      /*
       * Truncated. Kept out of place deliberately: a short dump parses fine for as far as it goes
       * and would import a partial galaxy, silently deleting nothing and adding most things — the
       * hardest kind of wrong to notice.
       */
      rmSync(part, { force: true });
      return {
        changed: false,
        skipped: `download was ${got} bytes, expected ${expected}`,
        available: onDisk,
        bytes: null,
      };
    }

    renameSync(part, file);
    writeFileSync(metaPath(file), JSON.stringify({ lastModified, bytes: got }), 'utf8');
    return { changed: true, skipped: null, available: true, bytes: got };
  } catch (e) {
    rmSync(part, { force: true });
    return {
      changed: false,
      skipped: `download failed (${e instanceof Error ? e.message : String(e)})`,
      available: onDisk,
      bytes: null,
    };
  } finally {
    // Also on the success path and on every early return above, or a completed download would keep
    // the process alive for the remainder of the thirty seconds.
    clearTimeout(headers);
  }
}
