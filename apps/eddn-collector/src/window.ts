import type { PrismaClient } from '@grims/db';
import { announce } from '@grims/shared';

/**
 * Making a process that never finishes legible to a page built for jobs that do.
 *
 * ★ THE PROBLEM ★
 *
 * The training page answers one question per source: when did it last complete, and when is it due
 * again. Every other source is a cron job, so both have obvious answers. This one is a subscriber —
 * it starts once and runs for months. It has no runs.
 *
 * Left alone it would render as "Never run / not scheduled" for ever, sitting on a page whose whole
 * purpose is to show what is and is not working, quietly implying that markets are not being
 * collected while they are.
 *
 * ★ THE ANSWER: REPORT IN WINDOWS ★
 *
 * Every fifteen minutes the collector closes the current window and opens the next. Each closed
 * window is a `knowledge_ingests` row with a real `finished_at` and a real count, and an audit entry
 * saying how many markets were written.
 *
 * That gets three things with no schema change and no special case on the page:
 *
 *   - "Trained N minutes ago" instead of "Never run", and a count that visibly climbs.
 *   - `REFRESH_HOURS.eddn = 1` becomes a genuine alarm: four windows are expected inside the hour,
 *     so "overdue" can only mean the collector has actually stopped. A dead subscriber otherwise
 *     looks exactly like a quiet one, which is the failure nobody catches.
 *   - The audit trail the squadron owner asked for on 2026-08-01 — "so we can see when training on
 *     various ingestion sources were run and complete, and how many new / updated / removed records
 *     there were in that run" — for a source that has no runs to log.
 */

/**
 * How long one reporting window lasts. See `REFRESH_HOURS.eddn` for why this must stay under an hour.
 *
 * Overridable because fifteen minutes is unusable to verify against: checking that a window closes,
 * writes its audit entry and opens the next one would otherwise mean a fifteen-minute wait per
 * attempt, which in practice means nobody checks it.
 */
export const EDDN_WINDOW_MINUTES = readWindowMinutes();

function readWindowMinutes(): number {
  const raw = Number(process.env['EDDN_WINDOW_MINUTES']);
  // Anything unparseable, zero, negative or over an hour falls back: a window longer than
  // REFRESH_HOURS.eddn would make the source permanently overdue on the training page.
  return Number.isFinite(raw) && raw > 0 && raw <= 60 ? raw : 15;
}

/** What happened during one window. */
export interface WindowCounts {
  /** Market messages successfully written. */
  markets: number;
  /** Rows written across those markets. */
  rows: number;
  /** Rows dropped and not put back — commodities stations have stopped trading. See `ApplyResult`. */
  removed: number;
  /** Messages for stations we do not hold. Normal, and worth watching if it dominates. */
  unknownStations: number;
  /** Commodity symbols we could not name. Should be zero except after a game update. */
  unresolved: number;
  /** Messages that failed to write. */
  failed: number;
}

export function emptyCounts(): WindowCounts {
  return { markets: 0, rows: 0, removed: 0, unknownStations: 0, unresolved: 0, failed: 0 };
}

/**
 * Opens a window: one unfinished `knowledge_ingests` row.
 *
 * `progress_at` is set on creation because the page treats it as the heartbeat — a null there for
 * the first fifteen minutes would read as a job that started and immediately stalled.
 */
/**
 * Closes any window left open by a previous life of this process.
 *
 * ★ THE SIGNAL HANDLER IS NOT ENOUGH, AND CANNOT BE ★
 *
 * A clean SIGTERM closes the current window on the way out. That covers `docker stop` and nothing
 * else: a crash, an OOM kill, `kill -9`, or a host losing power all leave an unfinished row behind,
 * and fifteen minutes later the training page reports a stall for a collector that is running
 * perfectly well. It also cannot be verified on Windows at all — Node there does not deliver
 * SIGTERM to the handler, which is exactly how this was found.
 *
 * Reconciling on the way IN needs no cooperation from the process that died. It runs once, under
 * the advisory lock, so there is no second collector to race with.
 *
 * `finished_at` is set from `progress_at` rather than `now()`: the heartbeat is the last moment we
 * know the old process was alive, and stamping the present would claim it kept working through
 * however long it was actually dead.
 */
export async function reconcileOpenWindows(db: PrismaClient): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE knowledge_ingests
        SET finished_at = COALESCE(progress_at, started_at),
            error = 'The collector stopped without closing this window — it was restarted.'
      WHERE source = 'eddn' AND finished_at IS NULL`,
  );
}

export async function openWindow(db: PrismaClient): Promise<string> {
  // Same statement shape as `beginIngest` in the worker: the table fills id and started_at itself.
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO knowledge_ingests (source, rows, progress_at) VALUES ('eddn', 0, now()) RETURNING id`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('eddn: could not open a reporting window');
  return id;
}

/**
 * Bumps the heartbeat and the running count.
 *
 * Called on a timer rather than per message: at roughly one market a second an UPDATE per message
 * would be a write per second for a number nobody reads more than twice a minute.
 */
export async function beat(db: PrismaClient, id: string, rows: number): Promise<void> {
  await db
    .$executeRawUnsafe(
      `UPDATE knowledge_ingests SET rows = $2, progress_at = now() WHERE id = $1::uuid`,
      id,
      rows,
    )
    .catch(() => undefined);
}

/**
 * Closes a window and records what it did.
 *
 * ★ `removed` IS NOT ZERO HERE, UNLIKE EVERY OTHER SOURCE ★
 *
 * The other ingests add and update. This one REPLACES a station's rows, so a station that stopped
 * trading a commodity genuinely loses a row — and that is the single most valuable thing the
 * collector does, because a stale row routes somebody to sell a cargo hold nobody there wants.
 * Counting it as "updated" would hide the one number that shows the feed is correcting us.
 */
export async function closeWindow(
  db: PrismaClient,
  id: string,
  counts: WindowCounts,
  startedAt: number,
): Promise<void> {
  const tookMs = Date.now() - startedAt;

  await db.$executeRawUnsafe(
    `UPDATE knowledge_ingests SET finished_at = now(), rows = $2, progress_at = now() WHERE id = $1::uuid`,
    id,
    counts.rows,
  );

  /*
   * Prisma's model rather than raw SQL, so this row is shaped by the same code path as every other
   * audit entry — `actorType` and the JSON column are the two things a hand-written INSERT gets
   * subtly wrong, and an audit log that is subtly wrong is worse than none.
   *
   * Swallowed on failure: an audit write must never take down the collector it is describing.
   */
  await db.auditLog
    .create({
      data: {
        actorType: 'system',
        action: 'knowledge.ingest.completed',
        targetType: 'knowledge_source',
        targetId: 'eddn',
        after: {
          rows: counts.rows,
          /*
           * Same three keys as every other source, so the audit view needs no special case.
           *
           * `updated` is always zero and that is not a stub: this source replaces a station's rows
           * outright, so nothing is ever updated in place. Reporting the replacements as updates
           * would be a more comfortable number and a false one.
           */
          inserted: counts.rows,
          updated: 0,
          removed: counts.removed,
          markets: counts.markets,
          unknownStations: counts.unknownStations,
          unresolved: counts.unresolved,
          failed: counts.failed,
          windowMinutes: EDDN_WINDOW_MINUTES,
          tookMs,
        },
      },
    })
    .catch(() => undefined);

  await announce(db, {
    level: counts.failed > 0 ? 'warn' : 'info',
    kind: 'eddn',
    message:
      `${counts.markets.toLocaleString()} markets refreshed, ${counts.rows.toLocaleString()} prices` +
      `${counts.removed > 0 ? ` · ${counts.removed.toLocaleString()} stale rows dropped` : ''}` +
      `${counts.unknownStations > 0 ? ` · ${counts.unknownStations.toLocaleString()} stations we do not hold` : ''}` +
      `${counts.unresolved > 0 ? ` · ${counts.unresolved.toLocaleString()} unnamed commodities` : ''}` +
      `${counts.failed > 0 ? ` · ${counts.failed.toLocaleString()} failed` : ''}`,
    tookMs,
  });
}
