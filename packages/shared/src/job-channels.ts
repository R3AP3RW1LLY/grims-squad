/**
 * The Postgres channels our own processes talk to each other on.
 *
 * ★ WHY A CONTRACT AND NOT JUST A STRING ★
 *
 * These names had FOUR independent definitions before this file existed — `gmsd_job_log` in the
 * worker and again in the API's listener, `gmsd_job_request` in the API's training service and
 * again in the worker daemon. Nothing joined them.
 *
 * A NOTIFY to a channel nobody is listening on is silently discarded. That is the property that
 * makes the mechanism nice to use and it is also what makes a typo undetectable: renaming one copy
 * does not fail a build, fail a test, or log a warning. It produces a button that says "Requested"
 * for ever and a live log that never scrolls — both of which happened here for other reasons and
 * cost hours to find.
 *
 * One definition, imported by every side. A rename now moves all of them or none.
 */

/** Worker and collector activity, going to the admin area's live log. */
export const JOB_LOG_CHANNEL = 'gmsd_job_log';

/** The training page asking for an ingest to run now. Payload is the source name. */
export const JOB_REQUEST_CHANNEL = 'gmsd_job_request';

/** One line on the live log. */
export interface JobLogLine {
  readonly level: 'info' | 'warn' | 'error';
  /** Shown as the source column: `ingest`, `embed`, `eddn`, `health`. */
  readonly kind: string;
  readonly message: string;
  /** Milliseconds, when the line describes something that finished. */
  readonly tookMs?: number;
}

/**
 * How long a message may be.
 *
 * `pg_notify` raises above 8000 bytes, which would turn a long error string into a failed job —
 * and an error string is precisely the field that arrives unexpectedly long.
 */
export const JOB_LOG_MAX_MESSAGE = 500;

/** Builds the payload. Pure, so both the encoder and the truncation are testable without a database. */
export function encodeJobLogLine(line: JobLogLine): string {
  return JSON.stringify({
    level: line.level,
    kind: line.kind,
    message: line.message.slice(0, JOB_LOG_MAX_MESSAGE),
    ...(line.tookMs === undefined ? {} : { tookMs: line.tookMs }),
  });
}

/**
 * The one thing `announce` needs from a database client.
 *
 * Structural rather than `PrismaClient`, so this contract does not drag Prisma's types into every
 * package that imports it — the web bundle imports from here too.
 */
export interface NotifyCapable {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

/**
 * Announces one line to the live log.
 *
 * ★ FIRE AND FORGET, ALWAYS ★
 *
 * A log line that fails must never fail the job it is describing. This swallows its own errors: the
 * work is the thing that matters and it has already happened.
 */
export async function announce(db: NotifyCapable, line: JobLogLine): Promise<void> {
  await db
    .$executeRawUnsafe(`SELECT pg_notify($1, $2)`, JOB_LOG_CHANNEL, encodeJobLogLine(line))
    .catch(() => undefined);
}

/**
 * The nightly commander audit, by the name every caller keys on.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add a button to the admin console to trigger an inara update manually ... pressing this should
 * not interupt the daily job."
 *
 * THREE things have to agree on this string or the guarantee evaporates:
 *
 *   the ADMIN CONSOLE  names it when it asks for a run
 *   the WORKER DAEMON  looks it up to know what to spawn
 *   the AUDIT ITSELF   derives its advisory lock id from it, and cron reaches that same code
 *
 * If the button and the lock disagreed by one character, a press would start a second audit
 * alongside the nightly one and nothing would report a problem — two processes renaming the same
 * members and spending a request budget of two a minute. So it is written once, here.
 */
export const COMMANDER_AUDIT_JOB = 'commanders';

/**
 * Where the Data Bounty board records how many project anchors it was built from.
 *
 * ★ IT LIVES HERE BECAUSE TWO PROCESSES HAVE TO AGREE ON IT ★
 *
 * The WORKER writes it when it rebuilds the board; the API reads it to decide which empty state
 * the ops section shows — "nothing near our projects is stale" and "there are no projects to be
 * near" are opposite claims, and the page made the first for both.
 *
 * Neither package depends on the other, so a string spelled in both would drift the first time
 * somebody renamed it, and the reader would silently look up a row that no longer exists — which
 * is the same silent-zero failure the anchor count exists to explain. Same reasoning as the
 * channel names above: a name four processes agree on belongs in the contract, not in one of them.
 */
export const BOUNTY_ANCHOR_COUNT_KEY = 'bounties.anchor_count';
