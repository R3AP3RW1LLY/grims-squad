import * as zmq from 'zeromq';
import { Client } from 'pg';
import { PrismaClient } from '@grims/db';
import { announce } from '@grims/shared';
import { marketFromEnvelope, type EddnMarket } from './message.js';
import { applyExtras, decodeEnvelope, ExtrasTally } from './extras.js';
import { CommodityNames } from './names.js';
import { StationCache } from './stations.js';
import { applyMarket } from './apply.js';
import {
  EDDN_WINDOW_MINUTES,
  beat,
  closeWindow,
  emptyCounts,
  openWindow,
  reconcileOpenWindows,
  type WindowCounts,
} from './window.js';

/**
 * @grims/eddn-collector — the EDDN firehose into Postgres. Singleton.
 *
 * ★ WHAT IT IS FOR ★
 *
 * `market_entries` is rebuilt nightly from the Spansh dump, so a price can be twenty-four hours old.
 * The routes worth flying are exactly the ones that drain fastest, which means the freshest data
 * matters most precisely where we have the least of it.
 *
 * The journal path already fixes this for stations OUR members visit. That is 107 commanders. EDDN
 * is the same information from everybody who plays with an uploader running — the whole bubble,
 * about one market a second, for free.
 *
 * ★ A SUBSCRIBER, NOT A JOB ★
 *
 * Everything else under `apps/worker` is started by cron, runs to completion and exits. This is the
 * opposite: it connects once and stays. Two properties follow from that, and both are load-bearing.
 *
 * ★ ONE — IT MUST NEVER EXIT ★
 *
 * A cron job that dies gets another chance in an hour. A resident process that dies is simply gone,
 * and a dead subscriber looks exactly like a quiet one: no error, no alert, just prices that
 * gradually stop being current. The worker daemon had this same hole — `await client.connect()`
 * throws when Postgres is not up yet, which happens every time somebody starts the stack before
 * Docker is ready. Everything here retries instead, indefinitely, and says so.
 *
 * ★ TWO — EXACTLY ONE OF IT ★
 *
 * Two collectors would both write every station, doubling the work and interleaving two
 * delete-and-insert transactions on the same rows. On 2026-08-01 an in-memory guard in the worker
 * daemon failed at precisely this: two processes each ran the same import because neither could see
 * the other. A Postgres advisory lock is the only guard that spans processes, and it is released
 * automatically when the holder dies — which a row in a table would not be.
 */

/** The public relay. */
const RELAY = 'tcp://eddn.edcd.io:9500';

/** Same namespace as the worker daemon, so the two families of lock cannot collide. */
const LOCK_NAMESPACE = 0x67_6d_73_64; // "gmsd"
const LOCK_ID = 1_001;

/** How long to wait before trying again after anything at all goes wrong. */
const RETRY_MS = 15_000;

/**
 * How long to stand aside when no commodity names can be read.
 *
 * Sized against the nightly market rebuild, whose transaction is budgeted at thirty minutes and
 * which holds ACCESS EXCLUSIVE on the table this needs. Five minutes retries often enough to come
 * back promptly and rarely enough that the attempts do not become the problem.
 */
const NO_NAMES_BACKOFF_MS = 5 * 60_000;

/**
 * Consecutive write failures before the collector stops trying for a while.
 *
 * Individual failures are normal and counted. A solid run of them means the table is locked or
 * gone, and continuing to attempt one write per message just adds load to whatever is already
 * struggling.
 */
const FAILURE_STREAK_LIMIT = 25;

/**
 * How long to sit silent before deciding the relay has gone away.
 *
 * ★ SILENCE IS THE FAILURE MODE THAT HAS NO ERROR ★
 *
 * A TCP connection to a relay that has stopped sending stays open and healthy-looking for ever.
 * ZeroMQ will not raise, the socket will not close, and the process will sit there consuming
 * nothing while every price ages. EDDN carries roughly twenty messages a second across all schemas,
 * so two minutes of total silence is not a quiet period — it is a broken feed.
 */
const SILENCE_MS = 2 * 60 * 1000;

/** How often to bump the heartbeat on the open reporting window. */
const BEAT_MS = 30_000;

/**
 * Set by SIGTERM/SIGINT. Read by the reconnect loop and by the consume loop.
 *
 * Module scope rather than passed around because the signal handler and the loops are in different
 * frames and there is exactly one collector per process — the thing a lock guarantees anyway.
 */
let stopping = false;

/** The socket currently being consumed, so a signal can unblock the iterator by closing it. */
let current: zmq.Subscriber | null = null;

/** Whether we have already said we are waiting for the lock. Reset once we get it. */
let announcedWaiting = false;

/** Consecutive failed writes. Reset by any success. See FAILURE_STREAK_LIMIT. */
let failureStreak = 0;

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    /*
     * ★ IT COMPLAINS FOR EVER RATHER THAN EXITING, AND THAT IS DELIBERATE ★
     *
     * Exiting non-zero is the tidier-looking choice and it is the wrong one here. This is a task in
     * `pnpm dev`, and TURBO TEARS DOWN EVERY OTHER TASK WHEN ONE FAILS — so a missing variable in a
     * developer's environment would take the web app and the API down with it, with the cause
     * scrolled off the top of a combined log. In a container the same exit is a restart loop, which
     * is this loop with more noise.
     *
     * Either way somebody has to set the variable. Saying so once a minute, from a process that is
     * otherwise harmless, is the version that does not break anything else while they do.
     */
    for (;;) {
      console.error('eddn: DATABASE_URL is not set — the collector cannot start without it');
      await sleep(60_000);
    }
  }

  const db = new PrismaClient();

  /*
   * ★ A CLEAN STOP MUST NOT LOOK LIKE A CRASH ★
   *
   * `docker stop` sends SIGTERM. Without a handler Node exits immediately, the `finally` that
   * closes the reporting window never runs, and an unfinished `knowledge_ingests` row is left
   * behind — which the training page correctly reports as a stall fifteen minutes later.
   *
   * So every ordinary restart would raise a false alarm, and a page that cries wolf on every deploy
   * is a page nobody reads on the day it is right. Observed here: two stranded OPEN rows after two
   * ordinary test runs.
   *
   * Setting the flag lets the consume loop fall out through its own `finally`, which closes the
   * window properly. `sock.close()` is what unblocks it.
   */
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return; // A second signal means impatience, not a new instruction.
      stopping = true;
      console.log(`eddn: ${signal} — closing the current window and stopping`);
      current?.close();
    });
  }

  while (!stopping) {
    try {
      await collect(db, url);
    } catch (e) {
      console.error(`eddn: ${e instanceof Error ? e.message : String(e)}`);
      await announce(db, {
        level: 'error',
        kind: 'eddn',
        message: `collector restarting — ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    if (stopping) break;
    await sleep(RETRY_MS);
  }

  await announce(db, { level: 'info', kind: 'eddn', message: 'collector stopped' });
  await db.$disconnect();
}

/**
 * One connected session: hold the lock, subscribe, and consume until something goes wrong.
 *
 * Returns — rather than looping internally — so that every failure takes the same path back to
 * `main`, which reconnects. A retry that reuses a half-broken socket is how a service ends up
 * "running" and receiving nothing.
 */
async function collect(db: PrismaClient, url: string): Promise<void> {
  /*
   * The lock is held by the SESSION, so it needs its own connection. Prisma's pool would hand the
   * connection back after the query and release the lock while we were still collecting — which
   * would silently permit the second collector this exists to prevent.
   */
  const lock = new Client({ connectionString: url });
  lock.on('error', () => undefined); // Unhandled 'error' on a pg Client ends the process.

  try {
    await lock.connect();
  } catch (e) {
    console.error(`eddn: no database (${e instanceof Error ? e.message : String(e)}), retrying`);
    await lock.end().catch(() => undefined);
    return;
  }

  const claimed = await lock
    .query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1, $2) AS ok`, [LOCK_NAMESPACE, LOCK_ID])
    .then((r) => r.rows[0]?.ok === true)
    .catch(() => false);

  if (!claimed) {
    /*
     * Another collector holds it — the normal state of the losing process during a rolling deploy,
     * which will take over by itself the moment the old one lets go.
     *
     * ★ SAID ONCE, BECAUSE SILENCE HERE IS INDISTINGUISHABLE FROM BROKEN ★
     *
     * The first version logged nothing at all, on the reasoning that this is not an error. It cost
     * a real debugging session: a hard-killed run had left its Postgres session open, so the lock
     * was still held, and the new collector sat there producing no output, no windows and no audit
     * entries. Every visible symptom of a completely broken process, from correct behaviour.
     *
     * Once per attempt, on the console rather than the live log: an operator looking at the process
     * needs it, and a page showing it every fifteen seconds does not.
     */
    if (!announcedWaiting) {
      console.log('eddn: another collector holds the lock — waiting to take over');
      announcedWaiting = true;
    }
    await lock.end().catch(() => undefined);
    await sleep(RETRY_MS);
    return;
  }
  announcedWaiting = false;

  const names = new CommodityNames();
  const stations = new StationCache();
  const known = await names.refresh(db);

  if (known === 0) {
    /*
     * No commodity names means nothing can be resolved, so every message would be discarded. Two
     * ways to get here, and both want the same response:
     *
     *   - The first galaxy ingest has never run, so there is nothing to learn names from.
     *   - The nightly rebuild holds the table and the name query timed out.
     *
     * ★ A LONG WAIT, NOT THE ORDINARY ONE ★
     *
     * The rebuild runs for up to thirty minutes. Retrying every fifteen seconds through that is how
     * four full scans of an eighteen-million-row table ended up queued at once. Backing off costs
     * nothing — the rebuild is rewriting every row we would have been updating.
     */
    await announce(db, {
      level: 'warn',
      kind: 'eddn',
      message: 'no commodity names available — waiting (first ingest, or a market rebuild is running)',
    });
    await lock.end().catch(() => undefined);
    await sleep(NO_NAMES_BACKOFF_MS);
    return;
  }

  const sock = new zmq.Subscriber();
  sock.connect(RELAY);
  sock.subscribe(''); // Everything — and since 2026-08-04, everything is CONSUMED (see extras.ts).
  current = sock;

  await announce(db, {
    level: 'info',
    kind: 'eddn',
    message:
      `connected to the EDDN relay · ${known.toLocaleString()} commodities known` +
      `${names.aliasCount > 0 ? `, ${names.aliasCount} EDCD aliases` : ', NO EDCD aliases (about a quarter of prices will be skipped)'}`,
  });

  /*
   * Anything the previous life left behind, closed before a new one is opened — otherwise the
   * training page sees two open windows and reports the older one as a stall for ever.
   */
  const stranded = await reconcileOpenWindows(db);
  if (stranded > 0) {
    await announce(db, {
      level: 'warn',
      kind: 'eddn',
      message: `closed ${stranded} reporting window(s) left open by a previous run`,
    });
  }

  let window = await openWindow(db);
  let windowStarted = Date.now();
  let counts = emptyCounts();
  const tally = new ExtrasTally();
  let lastMessage = Date.now();
  let lastBeat = Date.now();

  /*
   * ★ THE WATCHDOG HAS TO BE A TIMER, AND THE FIRST VERSION WAS NOT ★
   *
   * The obvious place to check "have we heard anything lately" is inside the loop, next to
   * everything else. It cannot work there: `for await` blocks until a message arrives, so the check
   * only runs when there IS traffic — the one moment it can never fire. A relay that went silent
   * would leave the process parked on the await for ever, connected, healthy, and receiving
   * nothing.
   *
   * A timer runs regardless. Closing the socket is what unblocks the iterator, which ends the loop
   * and takes the normal path back to `main` to reconnect.
   */
  let silent = false;
  const watchdog = setInterval(() => {
    if (Date.now() - lastMessage <= SILENCE_MS) return;
    silent = true;
    sock.close();
  }, SILENCE_MS / 2);

  try {
    for await (const [frame] of sock) {
      lastMessage = Date.now();
      if (frame !== undefined) await ingest(db, frame, names, stations, counts, tally);

      const now = Date.now();

      if (now - lastBeat >= BEAT_MS) {
        await beat(db, window, counts.rows);
        // The high-rate extras (traffic, schema stats) land here as one statement per table. A
        // failed flush keeps its counts and tries again next beat.
        await tally.flush(db).catch(() => undefined);
        lastBeat = now;
      }

      /*
       * A run of failures means the table is locked or unavailable — almost always the nightly
       * rebuild. Breaking out drops through to the reconnect path, which re-reads the names and
       * finds the same obstruction, and THAT backs off for five minutes. One decision, made in one
       * place, rather than a second timer here that could disagree with it.
       */
      if (failureStreak >= FAILURE_STREAK_LIMIT) {
        await announce(db, {
          level: 'warn',
          kind: 'eddn',
          message: `${failureStreak} consecutive failed writes — standing aside (a market rebuild is the usual cause)`,
        });
        failureStreak = 0;
        break;
      }

      if (now - windowStarted >= EDDN_WINDOW_MINUTES * 60_000) {
        await closeWindow(db, window, counts, windowStarted);
        // Never allowed to interrupt collection: a failed refresh keeps the map we already have.
        await names.refreshIfStale(db).catch(() => undefined);
        window = await openWindow(db);
        windowStarted = Date.now();
        counts = emptyCounts();
      }
    }
  } finally {
    clearInterval(watchdog);
    if (silent) {
      await announce(db, {
        level: 'warn',
        kind: 'eddn',
        message: `no messages for ${SILENCE_MS / 60_000} minutes — reconnecting to the relay`,
      });
    }
    /*
     * The window is closed on the way out whatever happened, so a restart does not strand an
     * unfinished row. A stranded row is what the training page reports as a stall — which would be
     * a correct description of a collector that had crashed, and a wrong one for a routine
     * reconnect.
     */
    await closeWindow(db, window, counts, windowStarted).catch(() => undefined);
    await tally.flush(db).catch(() => undefined);
    // Already closed if the watchdog fired or a signal arrived; closing twice raises.
    if (!silent && !stopping) sock.close();
    current = null;
    await lock.end().catch(() => undefined);
  }
}

/** Decodes one frame and writes it, counting whatever happened. Never throws. */
async function ingest(
  db: PrismaClient,
  frame: Buffer,
  names: CommodityNames,
  stations: StationCache,
  counts: WindowCounts,
  tally: ExtrasTally,
): Promise<void> {
  const env = decodeEnvelope(frame);
  if (env === null) return; // Not readable. One skipped message, never the process.

  let market: EddnMarket | null;
  try {
    market = marketFromEnvelope(env);
  } catch {
    return;
  }

  if (market === null) {
    /*
     * Not a market — one of the other nine schemas. Failures here are counted but kept OUT of
     * `failureStreak`: the streak exists to detect the market rebuild's lock on market_entries,
     * which the extras tables never contend with, and extras successes resetting it would mask
     * exactly the failures it watches for.
     */
    try {
      await applyExtras(db, env, tally);
    } catch {
      counts.failed += 1;
    }
    return;
  }

  try {
    const result = await applyMarket(db, market, names, stations);
    counts.unresolved += result.unresolved;
    for (const symbol of result.unknownSymbols) {
      // Bounded: EDDN is an untrusted feed, and an unbounded key set is a slow leak in a process
      // that runs for weeks. Past the cap the count still rises; only the naming stops.
      if (counts.unknownSymbols.size < 200 || counts.unknownSymbols.has(symbol)) {
        counts.unknownSymbols.set(symbol, (counts.unknownSymbols.get(symbol) ?? 0) + 1);
      }
    }
    /*
     * `unknownStation` no longer means "dropped" — since the provisional-station work the rows are
     * WRITTEN, under a `live:` key, so they count as a market like any other. The counter survives
     * as the measure of how often the galaxy baseline was not enough.
     */
    if (result.unknownStation) counts.unknownStations += 1;
    if (result.rows > 0) {
      counts.markets += 1;
      counts.rows += result.rows;
      counts.removed += result.removed;
    }
    failureStreak = 0;
  } catch {
    /*
     * One station failed to write. Counted and dropped: the feed does not replay, and blocking on a
     * retry would put us behind a stream that never slows down. The same station reports again.
     */
    counts.failed += 1;
    failureStreak += 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

await main();
