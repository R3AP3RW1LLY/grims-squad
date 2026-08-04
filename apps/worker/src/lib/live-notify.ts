/**
 * Telling the website that a scheduled job changed something.
 *
 * ★ WHY A JOB NEEDS TO SAY ANYTHING AT ALL ★
 *
 * A member ticks "I have applied to join the squadron", Inara has not caught up
 * yet, and the page tells them — truthfully — that they can leave it and will be
 * verified automatically. The squadron re-check confirms them four minutes
 * later, in THIS process.
 *
 * Without this, the page they were told they could leave open went on saying
 * "partially verified" until they gave up and reloaded by hand. The promise was
 * kept in the database and broken on the screen.
 *
 * ★ THE SHAPE OF WHAT IS SENT ★
 *
 * `{type, userId}` and nothing else — a notification, never data. The browser
 * responds by re-reading through the normal endpoint with the normal permission
 * checks, so this channel cannot disclose anything or grant anything. That is
 * what makes it safe for a second process to write to it.
 *
 * ★ AND IT CANNOT FAIL A JOB ★
 *
 * Every path here swallows its errors. A squadron re-check that verified eleven
 * members and could not reach Redis has done its job completely; the members are
 * verified, and the only cost is that their pages update on the next navigation
 * instead of instantly. Turning that into a non-zero exit would put a red line
 * in cron's mail for a notification.
 */

/** Deliberately identical to the API's `LiveEventType`. */
export type LiveEventType =
  | 'telemetry'
  | 'presence'
  | 'roster'
  | 'activity'
  | 'verification'
  /*
   * The bell. Per-member for personal rows, userId null for a squadron entry — the browser
   * re-reads its counts through the normal endpoint either way; the event carries nothing.
   */
  | 'notification';

export interface LiveEvent {
  readonly type: LiveEventType;
  /** Who it concerns. Null means squadron-wide — which is a choice, not a default. */
  readonly userId: string | null;
}

/** Must match `LIVE_CHANNEL` in apps/api/src/live/live.bridge.ts. */
const CHANNEL = 'grims:live';

/**
 * The one Redis method this needs.
 *
 * Typed structurally so the module can be tested with an object literal, and so
 * that nothing outside `notifyLive` imports ioredis — the client is created
 * lazily, and a job that publishes nothing never opens a connection.
 */
interface Publisher {
  publish(channel: string, message: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

/**
 * The client, plus the one event that must never go unhandled.
 *
 * ioredis emits `error` on a failed connection. With no listener attached it
 * prints "Unhandled error event" and a stack trace of its own — which lands in
 * cron's mail for a job that succeeded, and is exactly the sort of red text
 * that trains somebody to ignore the mailbox where a real failure will appear.
 */
interface Connectable extends Publisher {
  on(event: 'error', handler: (err: Error) => void): unknown;
}

/**
 * Publishes a batch through an already-open client.
 *
 * Separated from connection handling so the interesting behaviour — what gets
 * sent, what happens when a send fails — is testable without a Redis.
 */
export async function publishEvents(
  client: Publisher,
  events: readonly LiveEvent[],
): Promise<number> {
  let sent = 0;
  for (const event of events) {
    try {
      await client.publish(CHANNEL, JSON.stringify(event));
      sent += 1;
    } catch {
      /*
       * One failed publish does not abandon the rest. These are independent
       * members, and stopping at the first would mean a transient blip decided
       * that everybody after the eleventh in the list waits for a reload.
       */
    }
  }
  return sent;
}

/**
 * Opens a connection, publishes, closes.
 *
 * ★ SHORT-LIVED ON PURPOSE ★
 *
 * The worker is a one-shot cron container. A pooled or lazily-retained client
 * would keep the process alive after `main` resolved — the classic "the job
 * finished but the container never exits" — so this connects, sends, and quits.
 *
 * Returns how many were published so a caller can log it honestly rather than
 * claiming a success it did not observe.
 */
/**
 * The nudge every worker-side notification producer hands to `notifyMembers` / `notifySquadron`.
 *
 * ★ ONE TRANSLATION, NOT ONE PER JOB ★
 *
 * The notify module in @grims/db is process-neutral and asks its caller how to reach live badges.
 * In this process the answer is always the same — the Redis bridge — and each job restating the
 * mapping from "these members" to `{type:'notification'}` events would be the drift the module's
 * callback design exists to avoid. Failure is already swallowed inside `notifyLive`: rows have
 * landed by the time this runs, and a badge that updates on the next navigation is the whole cost.
 */
export async function notificationNudge(userIds: readonly string[] | 'everyone'): Promise<void> {
  await notifyLive(
    userIds === 'everyone'
      ? [{ type: 'notification', userId: null }]
      : userIds.map((userId) => ({ type: 'notification' as const, userId })),
  );
}

export async function notifyLive(events: readonly LiveEvent[]): Promise<number> {
  // No events, no connection. The common case for most jobs is nothing changed.
  if (events.length === 0) return 0;

  let client: Publisher | null = null;
  try {
    /*
     * Imported HERE rather than at module scope. A job that never notifies must
     * not pay for loading a Redis client, and — more to the point — must not
     * fail to start because ioredis is missing from an environment that never
     * needed it.
     */
    const { Redis } = await import('ioredis');
    const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      // A job must not sit retrying a notification. The work is already
      // committed; if Redis is not there within a few seconds, move on.
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      connectionName: 'grims-worker-notify',
      retryStrategy: () => null,
    }) as unknown as Connectable;

    /*
     * Attached BEFORE the first publish, which is the whole point — ioredis
     * emits `error` during connection, and a listener registered afterwards
     * would miss it. The handler does nothing on purpose: the caller learns
     * what happened from the returned count, and printing a stack trace for a
     * notification would put a failure in the log of a job that succeeded.
     */
    redis.on('error', () => undefined);

    client = redis;
    return await publishEvents(client, events);
  } catch {
    return 0;
  } finally {
    // `quit`, not `disconnect`: this client has queued PUBLISH commands and a
    // clean close is what guarantees they left before the process exits.
    if (client !== null) await client.quit().catch(() => undefined);
  }
}
