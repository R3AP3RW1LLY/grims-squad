import { createHash } from 'node:crypto';
import {
  AppError,
  ErrorCode,
  isAllowedEvent,
  pickAllowedFields,
  telemetryCategoryFor,
  isBaselineCategory,
  canonicalJson,
  type JournalEventName,
  type TelemetryCategoryName,
} from '@grims/shared';

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
}

export interface IngestStore {
  /** Inserts, ignoring anything whose eventKey is already present. */
  insertIgnoringDuplicates(
    rows: ReadonlyArray<{
      userId: string;
      deviceTokenId: string;
      category: TelemetryCategoryName;
      eventType: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      eventKey: string;
    }>,
  ): Promise<number>;
  /** Marks the member's month as having an observed Elite session. */
  markGameActivityObserved(userId: string, month: Date, at: Date): Promise<void>;
  /** The telemetry categories this member has opted into. Empty by default. */
  consentedCategories(userId: string): Promise<readonly string[]>;
}

export interface IngestResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  /**
   * Categories that were refused for want of consent, and how many events each
   * cost. Reported explicitly rather than folded into `rejected`, so the app can
   * tell the member exactly what was not stored and why (INV-013).
   */
  readonly refused: Record<string, number>;
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

/**
 * The idempotency key for an event (INV-017).
 *
 * ★ COMPUTED HERE, ON THE SERVER, FROM WHAT WE ACTUALLY STORE ★
 *
 * It used to arrive from the client, which was wrong in two ways. The unique
 * index over `event_key` is GLOBAL rather than per-member, so a client choosing
 * its own keys could claim keys another member's events would later need, and
 * the victim's genuine events would vanish as "duplicates" with nothing anywhere
 * recording that they ever arrived. And a client with a bug that reused one key
 * would silently lose everything after its first event.
 *
 * Deriving it from `deviceTokenId` makes both impossible: keys are namespaced by
 * a credential the caller cannot choose or forge, so nothing can collide with
 * another member's, or with its own past, except by genuinely resending the same
 * event.
 *
 * ★ THE PAYLOAD TERM IS LOAD-BEARING ★
 *
 * Journal timestamps have WHOLE-SECOND resolution, so handing in 18 massacre
 * missions emits 18 events sharing 3 timestamps. Without the payload in the
 * hash, 15 are swallowed as duplicates — under-counting exactly the activity we
 * exist to measure, with no anomaly visible in any metric (DATA-INTEGRITY B1).
 *
 * Hashed over the FILTERED payload, which is what gets stored, so the key
 * describes the row rather than something we discarded.
 */
export function eventKeyFor(input: {
  deviceTokenId: string;
  occurredAt: Date;
  eventType: string;
  payload: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(
      `${input.deviceTokenId}|${input.occurredAt.toISOString()}|${input.eventType}|${canonicalJson(input.payload)}`,
    )
    .digest('hex');
}

type Row = Parameters<IngestStore['insertIgnoringDuplicates']>[0][number];

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

    /*
     * ★ BASELINE ALWAYS, OPTIONAL ONLY WITH CONSENT (INV-013) ★
     *
     * The baseline — that they played, their ranks, their ships — comes with
     * running the app. It is what the platform exists to hold, and making it
     * conditional on a setting meant a member could run the app for a month and
     * be told they had not qualified for a promotion because of a box they
     * never saw. The consent is the INSTALL: the app is entirely optional,
     * ships switched off, and shows them a real batch from their own journals
     * before they turn it on.
     *
     * Everything else — where they went, what they fought, what they hauled —
     * is opt-in and off by default, because it answers questions about a MEMBER
     * rather than about the squadron.
     *
     * Refusals are reported back per category rather than silently dropped: the
     * invariant is explicit that a non-consented event gets a clear answer, so
     * the app can tell the member what was not stored instead of appearing to
     * work while sending into a void.
     */
    const consented = new Set(await this.store.consentedCategories(userId));

    const rows: Row[] = [];
    const sessionMonths = new Set<number>();
    const refused: Record<string, number> = {};
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

      const category = telemetryCategoryFor(e.name as JournalEventName);
      if (!isBaselineCategory(category) && !consented.has(category)) {
        refused[category] = (refused[category] ?? 0) + 1;
        continue;
      }

      // Filtered AGAIN, so a field the app should not have sent is not stored
      // even if it arrives.
      const payload = pickAllowedFields(e.name as JournalEventName, e.data);

      rows.push({
        userId,
        deviceTokenId,
        category,
        eventType: e.name,
        occurredAt,
        payload,
        // Ours, not the caller's. See eventKeyFor.
        eventKey: eventKeyFor({ deviceTokenId, occurredAt, eventType: e.name, payload }),
      });

      // LoadGame is the one that proves they played. Collected per month so a
      // batch spanning a month boundary marks both.
      if (e.name === 'LoadGame') sessionMonths.add(monthKeyOf(occurredAt).getTime());
    }

    const accepted = rows.length === 0 ? 0 : await this.store.insertIgnoringDuplicates(rows);

    /*
     * Activity is marked from every observed month, not only from newly
     * inserted rows: a duplicate LoadGame still proves the session happened.
     * Marking sets a flag rather than incrementing, so a re-send costs nothing —
     * and a member whose only successful send was a retry still gets credited
     * for a month they genuinely played.
     */
    for (const monthMs of sessionMonths) {
      await this.store.markGameActivityObserved(userId, new Date(monthMs), now);
    }

    return { accepted, duplicates: rows.length - accepted, rejected, refused };
  }
}
