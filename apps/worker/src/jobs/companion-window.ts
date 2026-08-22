import type { PrismaClient } from '@grims/db';

/**
 * Reporting that members' journals are still arriving.
 *
 * ★ SQUADRON OWNER, 2026-08-22 ★
 *
 * "this is not scheduled to run at all: Systems our members have flown to -- we need this to work
 * just like the realtime ingestion of market prices please so that this is a real time living
 * ingestion service! make it work exactly like the worker we built for: Live markets"
 *
 * ★ IT WAS ALREADY LIVE. IT HAD NO WAY TO SAY SO ★
 *
 * A companion system is written the instant a member jumps: their app pushes the journal event,
 * `recordSystemSighting` writes the row. That is as real-time as the market feed and there is no job
 * to schedule — which is why `companion` sits in the scheduler's RESIDENT list, so nothing tries to
 * "start" an ingest that has no start.
 *
 * Live markets is push-driven in exactly the same way and reports anyway, because the collector
 * closes a REPORTING WINDOW every fifteen minutes. This is that missing half. Without it the
 * training page renders "Never run" for a feed that has been running the whole time — on a page
 * whose entire purpose is showing what works and what does not.
 *
 * ★ WHY THIS LIVES IN THE WORKER AND NOT THE API ★
 *
 * The rows are written by API request handlers, which have no loop to hang a timer on and should
 * not grow one: a member's jump must not wait on bookkeeping. The worker daemon already ticks
 * continuously and is where every other periodic job lives.
 *
 * It also means a window closes whether or not anybody is flying, which is the point — see the note
 * on quiet windows below.
 */

/**
 * How long one reporting window lasts.
 *
 * Must stay well under `REFRESH_HOURS.companion` (one hour), so several windows are expected inside
 * the alarm period. A window longer than the alarm would mark the source permanently overdue while
 * it worked perfectly — the same trap `EDDN_WINDOW_MINUTES` documents.
 */
export const COMPANION_WINDOW_MINUTES = 15;

/** One closed window, as the training page reads it. */
export interface CompanionWindow {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly rows: number;
}

/**
 * The database, behind an interface so the logic above is testable without one.
 *
 * The same seam `journal-ingest.service.ts` uses for its galaxy writer, for the same reason.
 */
export interface CompanionWindowStore {
  /** Companion rows ingested in a half-open interval. */
  countSince(from: Date, to: Date): Promise<number>;
  /** When the previous window ended, or null if none has ever been recorded. */
  lastWindowEnd(): Promise<Date | null>;
  writeWindow(window: CompanionWindow): Promise<void>;
}

/**
 * Closes one window: count what arrived, write it down.
 *
 * ★ A QUIET WINDOW STILL CLOSES, AND THAT IS THE FEATURE ★
 *
 * Nobody flies at four in the morning. A window that only closed when somebody had flown would
 * leave the page reading "Never run" all night, which looks identical to the pairing path being
 * broken — the one thing this exists to make visible. Zero is a real answer; silence is not.
 *
 * ★ AND WHY IT MEASURES FROM THE LAST WINDOW ★
 *
 * If the worker was down for three hours, the first window after it returns covers those three
 * hours. Counting a flat fifteen minutes would silently drop everything members flew to while
 * nobody was watching, and the count is the only evidence the feed is alive.
 */
export async function closeCompanionWindow(
  store: CompanionWindowStore,
  now: Date,
): Promise<void> {
  try {
    const previous = await store.lastWindowEnd();
    const startedAt =
      previous ?? new Date(now.getTime() - COMPANION_WINDOW_MINUTES * 60_000);

    const rows = await store.countSince(startedAt, now);

    await store.writeWindow({ startedAt, finishedAt: now, rows });
  } catch (e) {
    /*
     * Reporting must never take down the thing it reports on, and must never wedge itself: a throw
     * here would kill the interval and freeze the page on an old timestamp — a stall that looks
     * exactly like the outage this job exists to reveal.
     */
    console.error(
      `companion-window: could not close a window (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

/** The store, against the real database. */
export function companionWindowStore(db: PrismaClient): CompanionWindowStore {
  return {
    async countSince(from, to) {
      const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n
           FROM knowledge_items
          WHERE source = 'companion' AND ingested_at >= $1 AND ingested_at < $2`,
        from,
        to,
      );
      return Number(rows[0]?.n ?? 0);
    },

    async lastWindowEnd() {
      const rows = await db.$queryRawUnsafe<Array<{ finished_at: Date | null }>>(
        `SELECT finished_at
           FROM knowledge_ingests
          WHERE source = 'companion' AND finished_at IS NOT NULL
          ORDER BY finished_at DESC
          LIMIT 1`,
      );
      return rows[0]?.finished_at ?? null;
    },

    async writeWindow(w) {
      /*
       * Written already CLOSED, unlike the collector's open-then-close pair.
       *
       * That pair is what forces `reconcileOpenWindows` on the collector: a crash between the two
       * strands an unfinished row and the page reports a stall for a process that is fine. Writing
       * one finished row per window means there is never an open row to strand, so that failure mode
       * does not exist here. The cost is no mid-window heartbeat, which does not matter when the
       * window is fifteen minutes and the alarm is an hour.
       */
      await db.$executeRawUnsafe(
        `INSERT INTO knowledge_ingests (source, started_at, finished_at, rows, progress_at)
         VALUES ('companion', $1, $2, $3, $2)`,
        w.startedAt,
        w.finishedAt,
        w.rows,
      );
    },
  };
}

/** Closes a window now, and every COMPANION_WINDOW_MINUTES after. */
export function startCompanionWindows(db: PrismaClient): void {
  const store = companionWindowStore(db);
  const tick = (): void => void closeCompanionWindow(store, new Date());

  /*
   * Once at startup as well as on the interval. A worker restarted after being down should report
   * what arrived while it was away rather than waiting a further fifteen minutes to say anything —
   * and `closeCompanionWindow` measures from the last window, so that first one covers the gap.
   */
  tick();
  setInterval(tick, COMPANION_WINDOW_MINUTES * 60_000);
}
