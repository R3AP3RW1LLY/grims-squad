import type { PrismaClient } from '@grims/db';
import { KNOWLEDGE_SOURCES, REFRESH_HOURS, type KnowledgeSource } from '@grims/shared';

/**
 * Making the ingests actually run.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "these need to run automatically every 30 minutes ... these need to run every hour automatically
 * ... this is a non-negotiable! these are clearly not triggering as we have overdue on them!"
 *
 * ★ THEY WERE NOT TRIGGERING, AND THE CADENCE WAS NOT WHY ★
 *
 * Nothing scheduled them. The whole schedule lived in `infra/cron/grims-worker`, a crontab that has
 * to be installed on the host by hand — and it was not installed in production, and there is no
 * cron on a developer's machine at all. The worker daemon listened for on-demand requests and
 * nothing else, so every source sat at whatever a human had last triggered.
 *
 * A test was even written that reads that crontab and asserts every source appears in it at a fast
 * enough cadence. It passed. It was checking that the FILE said the right thing, which it did, and
 * which had nothing to do with whether anything ran.
 *
 * ★ SO THE SCHEDULE MOVED INTO THE PROCESS THAT DOES THE WORK ★
 *
 * The worker now decides for itself, from the same `REFRESH_HOURS` the training page reads. One
 * number, one place. It works identically on a laptop and in production, needs nothing installed,
 * and cannot drift from the page that reports it — because a source is "overdue" and "due to run"
 * according to the same constant.
 */

/** How often the scheduler wakes and looks. Well under the shortest cadence, so nothing drifts late. */
export const TICK_MS = 60_000;

/**
 * Why an unfinished run only counts as "running" for a bounded window.
 *
 * A worker killed mid-ingest leaves a row with no `finished_at` and nothing to close it. Treated as
 * running for ever, that source would never be scheduled again — the exact silent stall this whole
 * change exists to remove, reintroduced by the guard against double-running.
 *
 * Six hours is longer than any real ingest here (the galaxy stream is the slowest at roughly two)
 * and short enough that a crash costs one cycle rather than an outage nobody sees.
 */
export const STALE_RUN_HOURS = 6;

/**
 * Sources this never schedules.
 *
 * EDDN is a resident subscriber in its own container. It has no run to start — it closes a
 * reporting window every fifteen minutes, and `REFRESH_HOURS.eddn` is an alarm threshold rather
 * than a schedule. Starting an "eddn ingest" would be starting nothing, once a minute, for ever.
 *
 * `companion` is the same shape for a different reason: paired companions PUSH systems as members
 * fly them. There is nothing to go and fetch, so scheduling it would start nothing, for ever, in
 * precisely the way this list exists to prevent.
 */
export const RESIDENT: readonly KnowledgeSource[] = ['eddn', 'companion'];

export interface LastRun {
  readonly source: KnowledgeSource;
  readonly finishedAt: Date | null;
  /** True while a run is in flight — a second one must not be started on top of it. */
  readonly running: boolean;
}

/**
 * Which sources are due.
 *
 * ★ NEVER RUN AT ALL IS DUE IMMEDIATELY ★
 *
 * A source with no completed run has `finishedAt: null`. Treating that as "not yet due" is how a
 * fresh deployment sits empty for a day waiting for a schedule that measures from a run that never
 * happened — so null is due, now.
 *
 * ★ A RUN IN FLIGHT BLOCKS ITS OWN SOURCE ★
 *
 * The galaxy ingest streams a nine-gigabyte dump and takes longer than an hour. Starting a second
 * one on the next tick would have two processes writing the same rows, each slowing the other,
 * for ever.
 */
export function dueSources(runs: readonly LastRun[], now: number): KnowledgeSource[] {
  const bySource = new Map(runs.map((r) => [r.source, r]));

  return KNOWLEDGE_SOURCES.filter((source) => {
    if (RESIDENT.includes(source)) return false;

    const last = bySource.get(source);
    if (last?.running === true) return false;
    if (last?.finishedAt == null) return true;

    const dueAfterMs = REFRESH_HOURS[source] * 3_600_000;
    return now - last.finishedAt.getTime() >= dueAfterMs;
  });
}

/**
 * The most recent run of every source, and whether one is still going.
 *
 * Read from `knowledge_ingests`, which is the same table the training page reports from — so "due"
 * here and "overdue" there can never disagree about the same source.
 */
export async function lastRuns(db: PrismaClient): Promise<LastRun[]> {
  /*
   * ★ GROUPED IN SQL, GAPS FILLED IN CODE ★
   *
   * The first version passed the source list into the query as `unnest($1::text[])` and forgot to
   * bind it — Prisma's tagged template takes parameters by interpolation, not by `$1`, so the query
   * threw on every tick with "expected 1 parameter, actual 0". The scheduler logged it and carried
   * on, which meant nothing ran and nothing looked broken beyond one line a minute.
   *
   * Asking for what exists and filling in the rest here needs no parameters at all, and a source
   * that has never run simply has no row — which is exactly the "never ran, due now" case.
   */
  /*
   * The cutoff is computed here and bound as a TIMESTAMP, not built in SQL.
   *
   * `make_interval(hours => ${STALE_RUN_HOURS})` looks right and fails at runtime: Prisma binds a
   * JavaScript number as bigint, and there is no `make_interval(hours => bigint)`. Postgres answers
   * 42883 — "function does not exist" — which reads like a missing extension rather than a type.
   * A Date binds as timestamptz with no ambiguity at all.
   */
  const staleBefore = new Date(Date.now() - STALE_RUN_HOURS * 3_600_000);

  const rows = await db.$queryRaw<
    Array<{ source: string; finished_at: Date | null; running: boolean }>
  >`
    SELECT source,
           max(finished_at) FILTER (WHERE finished_at IS NOT NULL) AS finished_at,
           bool_or(finished_at IS NULL AND started_at > ${staleBefore}) AS running
      FROM knowledge_ingests
     GROUP BY source`;

  const bySource = new Map(rows.map((r) => [r.source, r]));

  return KNOWLEDGE_SOURCES.map((source) => {
    const row = bySource.get(source);
    return {
      source,
      finishedAt: row?.finished_at ?? null,
      running: row?.running === true,
    };
  });
}
