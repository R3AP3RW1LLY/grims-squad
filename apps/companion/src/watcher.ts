import { readJournalChunk, journalFilesInOrder } from './journal-reader.js';
import { withMarketPrices } from './market-prices.js';
import { readRock, foldProspecting, EMPTY_PROSPECTING, type ProspectingState } from './prospector.js';
import { foldRefining, EMPTY_REFINING, type RefiningState } from './refinery.js';
import { DEFAULT_MINING_SETTINGS } from './mining-settings.js';
import type { ProspectThresholds } from '@grims/shared';
import { trackDocked, type DockedAt } from './docked.js';
import { foldTrip, EMPTY_TRIP, type TripLedger } from './trip-ledger.js';
import { foldCarrierHold, EMPTY_CARRIER_HOLD, type CarrierHoldState } from './carrier-hold.js';
import { hubKey, apiBaseUrlFor, type CompanionConfig } from './config.js';
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
  /**
   * Of those, the ones never read before.
   *
   * ★ WHY THIS IS NOT JUST `filesRead` ★
   *
   * The lifetime "journals read" tally must count each journal ONCE. A single
   * file is read on many passes as the game appends to it, so accumulating
   * `filesRead` would report a member who played one long session as having
   * read two hundred journals.
   *
   * Decided from whether the file had a saved offset BEFORE this pass, which is
   * the only record of having seen it. A first run records offsets for the old
   * journals it deliberately skips without reading them, and those correctly do
   * not count.
   */
  readonly newFilesRead: number;
  /**
   * Bytes moved by the journal uploads in this pass. See `UploadResult`.
   *
   * Summed across every request the pass made, including the ones that failed —
   * those bytes went out too.
   */
  readonly txBytes: number;
  readonly rxBytes: number;
  readonly sent: number;
  readonly duplicates: number;
  readonly refused: Record<string, number>;
  /** Set when the token has been revoked — the loop should stop until re-paired. */
  readonly unauthorised: boolean;
  readonly error: string | null;
  /**
   * Where the commander is docked, folded over every event this pass read.
   *
   * ★ SQUADRON OWNER, 2026-08-02 ★
   *
   * "it should appear automatically in the companion app on the new project page if it is not being
   * used please!" — of the market id a project needs.
   *
   * Carried out of the watcher rather than read again elsewhere, because this is the only place the
   * journal is parsed. A second reader would be a second set of offsets to keep in step, and the
   * one that fell behind would quietly serve a station the member left.
   *
   * Null means "not docked, as far as we know", which is also what a first run reports.
   */
  readonly dockedAt: DockedAt | null;
  /**
   * The trip P&L, folded over every event this pass read — the same plumbing as `dockedAt`, for
   * the same reason: this is the only place the journal is parsed, and a second reader would be a
   * second set of offsets that drift.
   */
  readonly trip: TripLedger;
  /**
   * The member's own carrier's hold, folded the same way. The caller pushes its snapshot to the
   * hub when it CHANGES — the fold lives here because this is the only place the journal is
   * parsed, and the debounce lives with the caller because sending is the caller's job.
   */
  readonly carrierHold: CarrierHoldState;
  /**
   * The rock in front of the member, and the session it belongs to.
   *
   * Folded here for the same reason as `trip` and `carrierHold`: this is the only place the
   * journal is parsed, and a second reader would be a second set of offsets that drift out of step.
   *
   * Both are subject to `watchingSince`, so a first-run replay of thirty old journals cannot report
   * a hit rate from last March as though it were this evening.
   */
  readonly prospecting: ProspectingState;
  readonly refining: RefiningState;
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
  /*
   * What we believed before this pass. Threaded through rather than held in module state so the
   * function stays pure enough to test — the same reason every other decision in this file is a
   * parameter rather than a global.
   */
  dockedBefore: DockedAt | null = null,
  /*
   * The running trip, threaded the same way. Defaults to the empty trip: a fresh app start begins
   * an empty ledger on purpose — nothing is seeded from the tail, see trip-ledger.ts.
   */
  tripBefore: TripLedger = EMPTY_TRIP,
  /*
   * The member's own carrier's hold, threaded the same way and unseeded for the same reason: a
   * ledger rebuilt from half a session shows figures whose starting point nobody can name.
   */
  carrierBefore: CarrierHoldState = EMPTY_CARRIER_HOLD,
  /*
   * ★ WHERE "WHAT I AM CARRYING" STOPS BEING HISTORY — REPORTED 2026-08-05 ★
   *
   * "it seems that it is tracking all the materials i buy and persisting them ... its giving me
   * the aggregated total of all the times ive bought it ... its also showing ive sold modular
   * terminals and ive never done that!"
   *
   * Both are the same fault. Every parsed event was folded into the trip ledger and the carrier
   * hold — including a FIRST-RUN REPLAY of up to thirty old journal files, and, since offsets
   * became per-hub, a full re-read of every journal whenever the app is pointed somewhere new. So
   * a member's entire purchase history piled into one lot, and `lastSale` was whatever the oldest
   * replay happened to end on: a real sale, from months ago, that nobody remembers making.
   *
   * `trip-ledger.ts` already states the principle — "a ledger rebuilt from half a session would
   * show costs whose starting point nobody can name" — it simply had nothing enforcing it against
   * replayed files. This is that boundary: only events at or after the moment this app started
   * WATCHING count as watched.
   *
   * The events themselves are still read and still uploaded. The hub wants the history; the
   * overlay's "what is in my hold right now" does not.
   */
  watchingSince: number = 0,
  /*
   * ★ APPENDED, NEVER INSERTED — 2026-08-06 ★
   *
   * The mining session, threaded the same way as `trip` and unseeded for the same reason: a hit
   * rate rebuilt from half a session is a number whose denominator nobody can name.
   *
   * These sit AFTER `watchingSince` because the first draft put them before it, which silently
   * shifted every existing caller's eighth argument — `watchingSince` arrived as
   * `prospectingBefore` and two replay-guard tests failed with no clue as to why. A positional
   * parameter list is only safe to append to.
   */
  prospectingBefore: ProspectingState = EMPTY_PROSPECTING,
  refiningBefore: RefiningState = EMPTY_REFINING,
  /*
   * The member's own thresholds, so a hit means what THEY said it means. Defaulted rather than
   * required: a caller that has not loaded settings yet still gets a working fold.
   */
  miningThresholds: ProspectThresholds = DEFAULT_MINING_SETTINGS,

): Promise<{ outcome: WatchOutcome; config: CompanionConfig }> {
  if (!config.enabled || config.deviceToken === '') {
    // Not an error. The app is installed and waiting, which is the state it
    // ships in — being installed is not consent to transmit.
    return { outcome: empty(null, tripBefore, carrierBefore, prospectingBefore, refiningBefore), config };
  }

  const all = journalFilesInOrder(await fs.listFiles(journalDir));

  /*
   * On a first run — no offsets recorded at all — only the most recent files
   * are considered. On every later run the full list is walked, because by then
   * the offsets say which are already done and re-checking one is a stat call.
   */
  /*
   * ★ THE POSITION IS PER HUB ★
   *
   * An offset says how far we have read a file. It never said where those lines were SENT, so a
   * development run against localhost advanced these numbers and the production hub silently
   * resumed from where development stopped — a member's whole history skipped, with nothing
   * anywhere reporting it. Reading is now tracked against the destination, so pointing the app at
   * a different hub starts that hub from the beginning and it receives everything. The hub
   * deduplicates, so a re-read costs bandwidth and never a duplicate row.
   */
  const hub = hubKey(apiBaseUrlFor(config, process.env));
  const hubOffsets = config.offsetsByHub[hub] ?? {};

  const isFirstRun = Object.keys(hubOffsets).length === 0;
  const files = isFirstRun ? all.slice(-FIRST_RUN_FILE_LIMIT) : all;

  /*
   * The flat map is a WORKING copy for this pass — every line below reads and writes one hub's
   * positions, exactly as it always did — and `commit` folds it back under the hub key on the way
   * out. Keeping the loop flat means this change is confined to the two ends of the function.
   */
  let next: CompanionConfig & { offsets: Record<string, number> } = {
    ...config,
    offsets: { ...hubOffsets },
    sessionLive: { ...config.sessionLive },
  };

  const commit = (
    working: CompanionConfig & { offsets: Record<string, number> },
  ): CompanionConfig => {
    const { offsets, ...rest } = working;
    return {
      ...rest,
      offsetsByHub: { ...config.offsetsByHub, [hub]: offsets },
    };
  };
  let filesRead = 0;
  let newFilesRead = 0;
  let txBytes = 0;
  let rxBytes = 0;
  let gameRunning = false;
  // Seeded from what the caller already believed, so a station docked at ten minutes ago survives
  // the passes in between that mention nothing.
  let docked: DockedAt | null = dockedBefore;
  // Likewise: a buy from three passes ago is still this trip's spend until an Undocked closes it.
  let trip: TripLedger = tripBefore;
  // And the carrier hold: cargo staged an hour ago is still aboard until the journal says otherwise.
  let carrierHold: CarrierHoldState = carrierBefore;
  let prospecting: ProspectingState = prospectingBefore;
  let refining: RefiningState = refiningBefore;
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
    // Read against the ORIGINAL config, not `next` — `next.offsets[name]` has
    // already been written by the time this pass finishes with the file.
    if (hubOffsets[name] === undefined) newFilesRead += 1;
    /*
     * The NEWEST file only. An old journal growing is not somebody playing —
     * it cannot happen — whereas a first-run replay reads dozens of old files
     * and would otherwise report every one of them as a live session.
     */
    if (name === files[files.length - 1]) gameRunning = true;

    const result = readJournalChunk(text, next.offsets[name] ?? 0, next.sessionLive[name] ?? null);

    if (result.sessionIsLive !== null) next.sessionLive[name] = result.sessionIsLive;

    /*
     * ★ THE PRICES, WHICH THE JOURNAL DOES NOT CARRY — 2026-08-06 ★
     *
     * Frontier's `Market` event is a five-field announcement: MarketID, StationName, StarSystem.
     * The commodity list goes into a SEPARATE file, `Market.json`, rewritten each time a market
     * screen is opened.
     *
     * Without it the hub's snapshot path returns immediately, no market row is ever written from a
     * member's upload, and the data bounty that pays on a written row is never reached. Production
     * had 1,092 Market events, zero rows and zero claims — the feature had never worked once.
     *
     * Read only when this chunk actually contains a Market event, so the ordinary pass — which is
     * most of them — touches nothing it did not before. `withMarketPrices` refuses the file unless
     * its MarketID matches the event's, because it holds only the LAST market opened and catching
     * up on an old journal would otherwise publish one station's prices under another's name.
     */
    let events = result.events;
    if (events.some((e) => e.name === 'Market')) {
      const marketJson = await fs.readFrom(`${journalDir}/Market.json`, 0).catch(() => null);
      if (marketJson !== null) {
        events = events.map((e) => {
          if (e.name !== 'Market') return e;
          const merged = withMarketPrices({ ...e.data, event: e.name }, marketJson);
          const items = merged['Items'];
          return items === undefined ? e : { ...e, data: { ...e.data, Items: items } };
        });
      }
    }

    /*
     * ★ FOLDED BEFORE THE "NOTHING TO SEND" RETURN, DELIBERATELY ★
     *
     * `Docked` is only uploaded when the member has left the `location` category on. Where they are
     * docked is needed by the app itself — to fill in a project form — whether or not the squadron
     * is allowed to know it, and reading it here rather than after the consent filter keeps those
     * two questions separate.
     *
     * Nothing about this leaves the machine. It is used to pre-fill a form the member is looking at.
     */
    docked = trackDocked(docked, events);
    /*
     * The trip P&L, folded in the same breath and before the same "nothing to send" return, for
     * the same reason as the dock: what a member paid at a buy screen is needed by the app's own
     * overlay whether or not any of these events is in a category the squadron receives.
     */
    /*
     * Only what this app actually WATCHED, never a replay of somebody's back catalogue. Filtered
     * once and shared: the two folds answer the same question about the present, and letting them
     * disagree about which events are current would be a bug nobody could reproduce.
     */
    const watched =
      watchingSince <= 0
        ? events
        : events.filter((e) => {
            const at = Date.parse(e.occurredAt);
            // An unparseable timestamp is not evidence of the present. Excluded rather than
            // guessed at — the cost is one missed line, and the alternative is the bug above.
            return Number.isFinite(at) && at >= watchingSince;
          });

    trip = foldTrip(trip, watched);

    /*
     * ★ MINING, FOLDED OVER THE SAME `watched` LIST ★
     *
     * Subject to `watchingSince` like everything else here: a first-run replay of thirty old
     * journals must not report last March's hit rate as though it were this evening's, which is the
     * exact fault that was reported against the trip ledger and the carrier hold.
     */
    for (const e of watched) {
      if (e.name === 'ProspectedAsteroid') {
        prospecting = foldProspecting(prospecting, readRock(e.data), miningThresholds);
      } else if (e.name === 'MiningRefined') {
        const at = Date.parse(e.occurredAt);
        refining = foldRefining(refining, e.data, Number.isFinite(at) ? at : Date.now());
      }
    }
    // The own-carrier hold, same breath, same reasoning. The caller decides whether its snapshot
    // is worth a push; the fold merely watches.
    carrierHold = foldCarrierHold(carrierHold, watched);

    if (events.length === 0) {
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
      if (gameRunning) {
        const beat = await uploader.send([], { gameRunning: true });
        txBytes += beat.txBytes;
        rxBytes += beat.rxBytes;
      }
      continue;
    }

    const upload = await uploader.send(events, { gameRunning });
    // Added BEFORE the early returns below, so a pass that failed partway still
    // reports what it moved.
    txBytes += upload.txBytes;
    rxBytes += upload.rxBytes;

    if (upload.unauthorised) {
      // Stop immediately, and do NOT advance. When the member re-pairs, this
      // picks up exactly where it left off.
      return {
        outcome: {
          ...empty(docked, trip, carrierHold),
          gameRunning,
          filesRead,
          newFilesRead,
          txBytes,
          rxBytes,
          unauthorised: true,
          error: upload.error,
        },
        config: commit(next),
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
        outcome: {
          ...empty(docked, trip, carrierHold),
          gameRunning,
          filesRead,
          newFilesRead,
          txBytes,
          rxBytes,
          sent,
          duplicates,
          refused,
          error: upload.error,
        },
        config: commit(next),
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
    outcome: {
      dockedAt: docked,
      trip,
      carrierHold,
      prospecting,
      refining,
      gameRunning,
      filesRead,
      newFilesRead,
      txBytes,
      rxBytes,
      sent,
      duplicates,
      refused,
      unauthorised: false,
      error: null,
    },
    config: commit(next),
  };
}

/**
 * Forgets offsets for files that are no longer on disk.
 *
 * Journals accumulate for years and members delete them. Without this the
 * config grows without limit and eventually becomes a slow read on every pass.
 */
export function pruneOffsets<T extends { offsets: Record<string, number>; sessionLive: Record<string, boolean> }>(
  config: T,
  present: readonly string[],
): T {
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

function empty(
  dockedAt: DockedAt | null = null,
  trip: TripLedger = EMPTY_TRIP,
  carrierHold: CarrierHoldState = EMPTY_CARRIER_HOLD,
  prospecting: ProspectingState = EMPTY_PROSPECTING,
  refining: RefiningState = EMPTY_REFINING,
): WatchOutcome {
  return {
    dockedAt,
    trip,
    carrierHold,
    prospecting,
    refining,
    gameRunning: false,
    filesRead: 0,
    newFilesRead: 0,
    txBytes: 0,
    rxBytes: 0,
    sent: 0,
    duplicates: 0,
    refused: {},
    unauthorised: false,
    error: null,
  };
}
