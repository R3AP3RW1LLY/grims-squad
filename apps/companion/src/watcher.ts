import { readJournalChunk, journalFilesInOrder } from './journal-reader.js';
import type { CompanionConfig } from './config.js';
import type { Uploader } from './uploader.js';

/**
 * The loop: read what is new, send it, remember how far we got.
 *
 * ★ NO ELECTRON IN THIS FILE, DELIBERATELY ★
 *
 * Everything here is decisions — when to read, what to skip, whether to advance
 * an offset. All of it is testable with plain objects, and none of it needs a
 * window, a tray or a running app. The Electron half is a timer and a menu, and
 * it stays that thin on purpose: a bug in the loop is a bug we can write a test
 * for.
 *
 * ★ AN OFFSET ADVANCES ONLY AFTER A SUCCESSFUL SEND ★
 *
 * That is the whole durability story. Crash, lose the network, close the laptop
 * — the events are read again next pass and the hub dedupes them. Advancing
 * first would make a failed send a silent, permanent loss, and nobody would
 * ever know which events had gone.
 */

export interface JournalFs {
  listFiles(dir: string): Promise<string[]>;
  /** Reads from a byte offset to the end. */
  readFrom(path: string, offset: number): Promise<string>;
  sizeOf(path: string): Promise<number>;
}

export interface WatchOutcome {
  /**
   * The newest journal file GREW during this pass.
   *
   * The only honest "they are playing right now" signal available. Elite's
   * journal clusters at session start and then goes quiet for hours, so
   * inferring presence from the events we receive would report somebody three
   * hours into a flight as offline — which is when they are most worth finding.
   *
   * Detected from the file SIZE, so it needs no widening of what we read and
   * transmits nothing beyond a boolean.
   */
  readonly gameRunning: boolean;
  readonly filesRead: number;
  readonly sent: number;
  readonly duplicates: number;
  readonly refused: Record<string, number>;
  /** Set when the token has been revoked — the loop should stop until re-paired. */
  readonly unauthorised: boolean;
  readonly error: string | null;
}

/**
 * How many files back to look on a first run.
 *
 * ★ WHY NOT ALL OF THEM ★
 *
 * A member who has played since 2015 has thousands of journal files, and the
 * first launch would spend an hour uploading a decade of history that answers
 * no question anybody is asking. Promotions look at THIS month.
 *
 * Enough to cover a first install partway through a month, and cheap enough
 * that the first run finishes while the member is still looking at the window.
 */
export const FIRST_RUN_FILE_LIMIT = 30;

/**
 * One pass: read every journal that has grown, send, save.
 *
 * Returns what happened rather than logging it, so the caller decides what the
 * member sees. A tray icon that silently swallowed an error would be worse than
 * no tray icon.
 */
export async function runWatchPass(
  fs: JournalFs,
  journalDir: string,
  config: CompanionConfig,
  uploader: Uploader,
): Promise<{ outcome: WatchOutcome; config: CompanionConfig }> {
  if (!config.enabled || config.deviceToken === '') {
    // Not an error. The app is installed and waiting, which is the state it
    // ships in — being installed is not consent to transmit.
    return { outcome: empty(), config };
  }

  const all = journalFilesInOrder(await fs.listFiles(journalDir));

  /*
   * On a first run — no offsets recorded at all — only the most recent files
   * are considered. On every later run the full list is walked, because by then
   * the offsets say which are already done and re-checking one is a stat call.
   */
  const isFirstRun = Object.keys(config.offsets).length === 0;
  const files = isFirstRun ? all.slice(-FIRST_RUN_FILE_LIMIT) : all;

  let next = { ...config, offsets: { ...config.offsets }, sessionLive: { ...config.sessionLive } };
  let filesRead = 0;
  let gameRunning = false;
  let sent = 0;
  let duplicates = 0;
  const refused: Record<string, number> = {};

  for (const name of files) {
    const path = `${journalDir}/${name}`;
    const offset = next.offsets[name] ?? 0;

    const size = await fs.sizeOf(path).catch(() => -1);
    if (size < 0) continue;

    if (size < offset) {
      /*
       * The file SHRANK. It has been replaced, truncated, or restored from a
       * backup — whatever the cause, our offset points into a file that no
       * longer exists in that shape. Reading from it would slice mid-line and
       * produce garbage, so we start again from the top and let the hub dedupe
       * what it has already seen.
       */
      next.offsets[name] = 0;
      delete next.sessionLive[name];
    }

    if (size === next.offsets[name]) continue;

    const text = await fs.readFrom(path, next.offsets[name] ?? 0).catch(() => null);
    if (text === null) continue;

    filesRead += 1;
    /*
     * The NEWEST file only. An old journal growing is not somebody playing —
     * it cannot happen — whereas a first-run replay reads dozens of old files
     * and would otherwise report every one of them as a live session.
     */
    if (name === files[files.length - 1]) gameRunning = true;

    const result = readJournalChunk(text, next.offsets[name] ?? 0, next.sessionLive[name] ?? null);

    if (result.sessionIsLive !== null) next.sessionLive[name] = result.sessionIsLive;

    if (result.events.length === 0) {
      /*
       * Nothing to send, but the offset still moves: those bytes have been read
       * and re-reading them next pass would be work with no possible outcome.
       *
       * A heartbeat still goes out when the newest file grew — that is the case
       * this exists for. Somebody flying between systems produces plenty of
       * journal lines and almost none we are allowed to send, and they are
       * exactly the member a roster should show as playing.
       */
      next.offsets[name] = result.offset;
      if (gameRunning) await uploader.send([], { gameRunning: true });
      continue;
    }

    const upload = await uploader.send(result.events, { gameRunning });
    if (upload.unauthorised) {
      // Stop immediately, and do NOT advance. When the member re-pairs, this
      // picks up exactly where it left off.
      return {
        outcome: { ...empty(), gameRunning, filesRead, unauthorised: true, error: upload.error },
        config: next,
      };
    }

    if (!upload.ok) {
      /*
       * Offline, or the hub is down. The offset stays where it is and this file
       * is read again next pass. We stop rather than continuing to the next
       * file: if the network is gone it is gone for all of them, and trying
       * each in turn just makes the member wait.
       */
      return {
        outcome: { ...empty(), gameRunning, filesRead, sent, duplicates, refused, error: upload.error },
        config: next,
      };
    }

    sent += upload.accepted;
    duplicates += upload.duplicates;
    for (const [category, count] of Object.entries(upload.refused)) {
      refused[category] = (refused[category] ?? 0) + count;
    }

    // ★ Only now. See the note at the top of this file. ★
    next.offsets[name] = result.offset;
  }

  /*
   * A first run records an offset for every file it decided to skip, so the
   * next pass does not treat itself as a first run and re-read the same window
   * forever. Skipped files are marked as fully read, because we have DECIDED
   * not to send them rather than failed to.
   */
  if (isFirstRun) {
    for (const name of all) {
      if (next.offsets[name] === undefined) {
        next.offsets[name] = await fs.sizeOf(`${journalDir}/${name}`).catch(() => 0);
      }
    }
  }

  next = pruneOffsets(next, all);
  return {
    outcome: { gameRunning, filesRead, sent, duplicates, refused, unauthorised: false, error: null },
    config: next,
  };
}

/**
 * Forgets offsets for files that are no longer on disk.
 *
 * Journals accumulate for years and members delete them. Without this the
 * config grows without limit and eventually becomes a slow read on every pass.
 */
export function pruneOffsets(config: CompanionConfig, present: readonly string[]): CompanionConfig {
  const live = new Set(present);
  const offsets: Record<string, number> = {};
  const sessionLive: Record<string, boolean> = {};

  for (const [name, offset] of Object.entries(config.offsets)) {
    if (live.has(name)) offsets[name] = offset;
  }
  for (const [name, isLive] of Object.entries(config.sessionLive)) {
    if (live.has(name)) sessionLive[name] = isLive;
  }
  return { ...config, offsets, sessionLive };
}

function empty(): WatchOutcome {
  return {
    gameRunning: false,
    filesRead: 0,
    sent: 0,
    duplicates: 0,
    refused: {},
    unauthorised: false,
    error: null,
  };
}
