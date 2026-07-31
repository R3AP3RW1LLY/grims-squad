import type { PrismaClient } from '@grims/db';

/**
 * Putting worker activity on the admin area's live log.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add all ingesting and embedding to the live log found on this page please! /app?tab=moderation"
 *
 * ★ WHY THIS IS NOT JUST A FUNCTION CALL ★
 *
 * The live log is `AiStreamService`, and it is IN MEMORY inside the API process. The worker is a
 * different container — started by cron, run to completion, thrown away. It cannot reach that
 * object, and there is no shared process to put one in.
 *
 * ★ pg_notify, NOT AN HTTP ENDPOINT ★
 *
 * The obvious alternative is the worker POSTing to the API. That means inventing an internal
 * endpoint, authenticating one of our own services to another, and handling the API being down
 * while a job is mid-import.
 *
 * Both processes already hold a Postgres connection. `NOTIFY` is push, arrives in milliseconds,
 * needs no port, no credential and no retry — and when nobody is listening it costs nothing and is
 * silently discarded, which is exactly the behaviour wanted for a log line.
 *
 * ★ FIRE AND FORGET, ALWAYS ★
 *
 * A log line that fails must never fail the import it is describing. Every call here swallows its
 * own errors: the job is the thing that matters and it has already done the work.
 */

/** The channel the API listens on. One name, in one place, or the two sides never meet. */
export const JOB_LOG_CHANNEL = 'gmsd_job_log';

export interface JobLogLine {
  readonly level: 'info' | 'warn' | 'error';
  /** Shown as the source column. `ingest` or `embed`. */
  readonly kind: string;
  readonly message: string;
  /** Milliseconds, when the line describes something that finished. */
  readonly tookMs?: number;
}

/**
 * Announces one line.
 *
 * ★ TRUNCATED, BECAUSE NOTIFY HAS A HARD LIMIT ★
 *
 * A payload over 8000 bytes makes `pg_notify` raise, which would turn a long error message into a
 * failed job. Nothing here should ever be near that, and "should never" is not a reason to let it
 * throw — an error string is exactly the field that arrives unexpectedly long.
 */
export async function announce(db: PrismaClient, line: JobLogLine): Promise<void> {
  const payload = JSON.stringify({
    level: line.level,
    kind: line.kind,
    message: line.message.slice(0, 500),
    ...(line.tookMs === undefined ? {} : { tookMs: line.tookMs }),
  });

  await db
    .$executeRawUnsafe(`SELECT pg_notify($1, $2)`, JOB_LOG_CHANNEL, payload)
    .catch(() => undefined);
}
