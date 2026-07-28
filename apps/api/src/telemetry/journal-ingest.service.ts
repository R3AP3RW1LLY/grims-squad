import { AppError, ErrorCode, isAllowedEvent, pickAllowedFields } from '@grims/shared';

/**
 * Receiving journal events from the companion app (P1.11).
 *
 * ★ WHAT THIS UNBLOCKS ★
 *
 * Every activity row in production reads `game_activity = 'unknown'`, so the
 * qualification rule — any Discord activity AND an Elite session — cannot be
 * satisfied by anybody, and the promotion engine would report zero on 1 August
 * whatever else were built. A LoadGame event arriving here is what turns that
 * into `observed`.
 *
 * ★ THE APP FILTERS, AND SO DOES THIS ★
 *
 * The companion already drops everything outside the allowlist before
 * transmitting. This re-applies the same filter on receipt — not because that
 * catches a hostile client (a modified app can send whatever it likes), but
 * because a FUTURE VERSION OF OUR OWN APP with a bug must not be able to widen
 * what we store. The client-side filter is the privacy design; this one is the
 * blast radius.
 */

export interface IncomingEvent {
  readonly name: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
  readonly eventKey: string;
}

export interface IngestStore {
  /** Inserts, ignoring anything whose eventKey is already present. */
  insertIgnoringDuplicates(
    rows: ReadonlyArray<{
      userId: string;
      deviceTokenId: string;
      eventType: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      eventKey: string;
    }>,
  ): Promise<number>;
  /** Marks the member's month as having an observed Elite session. */
  markGameActivityObserved(userId: string, month: Date, at: Date): Promise<void>;
}

export interface IngestResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
}

/** One request may not carry more than this. */
export const MAX_EVENTS_PER_REQUEST = 500;

/**
 * How far out of step an event's timestamp may be.
 *
 * A journal is replayed from disk, so genuinely old events are normal — a
 * member installing the app for the first time has months of them. But an event
 * from the FUTURE is either a broken clock or an attempt to bank activity for a
 * month that has not happened, and neither should be recorded.
 */
const MAX_FUTURE_SKEW_MS = 6 * 60 * 60 * 1000;

/** First of the month, UTC — the key `member_activity_months` is stored under. */
export function monthKeyOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export class JournalIngestService {
  constructor(private readonly store: IngestStore) {}

  async ingest(
    userId: string,
    deviceTokenId: string,
    events: readonly IncomingEvent[],
    now: Date = new Date(),
  ): Promise<IngestResult> {
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Too many events in one request (limit ${MAX_EVENTS_PER_REQUEST}).`,
      );
    }

    const rows: Array<{
      userId: string;
      deviceTokenId: string;
      eventType: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      eventKey: string;
    }> = [];
    const sessionMonths = new Set<number>();
    let rejected = 0;

    for (const e of events) {
      // Re-applied server side. Not a defence against a hostile client — it is
      // a ceiling on what a buggy future version of our own app could store.
      if (!isAllowedEvent(e.name)) {
        rejected += 1;
        continue;
      }

      const occurredAt = new Date(e.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        rejected += 1;
        continue;
      }

      if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
        /*
         * A future timestamp is a broken clock or an attempt to bank activity
         * for a month that has not happened yet. Old events are fine — a first
         * install replays months of them — but forward is refused.
         */
        rejected += 1;
        continue;
      }

      if (typeof e.eventKey !== 'string' || e.eventKey.length < 32) {
        // The key is what makes a retry safe. Without a real one we cannot
        // dedupe, and accepting it would let a crash-loop inflate activity.
        rejected += 1;
        continue;
      }

      rows.push({
        userId,
        deviceTokenId,
        eventType: e.name,
        occurredAt,
        // Filtered AGAIN, so a field the app should not have sent is not stored
        // even if it arrives.
        payload: pickAllowedFields(e.name, e.data),
        eventKey: e.eventKey,
      });

      // LoadGame is the one that proves they played. Collected per month so a
      // batch spanning a month boundary marks both.
      if (e.name === 'LoadGame') sessionMonths.add(monthKeyOf(occurredAt).getTime());
    }

    const accepted = rows.length === 0 ? 0 : await this.store.insertIgnoringDuplicates(rows);

    /*
     * Activity is marked from ACCEPTED rows only... except that a duplicate
     * LoadGame still proves the session happened. Marking on every observed
     * month is idempotent — it sets a flag rather than incrementing — so a
     * re-send costs nothing and a first-install replay correctly backfills
     * every month the member actually played.
     */
    for (const monthMs of sessionMonths) {
      await this.store.markGameActivityObserved(userId, new Date(monthMs), now);
    }

    return { accepted, duplicates: rows.length - accepted, rejected };
  }
}
