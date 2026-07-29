import { createHash } from 'node:crypto';
import {
  AppError,
  ErrorCode,
  isAllowedEvent,
  pickAllowedFields,
  telemetryCategoryFor,

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
  /**
   * What this member has switched OFF (INV-013, amended 2026-07-29).
   *
   * Both scopes: whole categories, and individual events by name. Empty means
   * everything is kept, which is the default.
   */
  telemetryOptOuts(userId: string): Promise<{
    categories: readonly string[];
    events: readonly string[];
  }>;
  /** Records that the member's journal is being written right now. */
  markPlaying(userId: string, at: Date): Promise<void>;
  /**
   * How much this member has contributed, in total.
   *
   * ★ THE SERVER IS THE AUTHORITY HERE, NOT THE APP ★
   *
   * The companion counts what IT sent from THIS machine. That is a different
   * number: it misses everything sent from a second PC, it double-counts an
   * event resent after a failed upload, and it resets to zero if the config
   * file is ever lost. This is the row count actually held for them.
   */
  contribution(userId: string): Promise<{ storedEvents: number; firstEventAt: Date | null }>;
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

  /** How much this member has contributed in total. See `IngestStore`. */
  async contribution(userId: string): Promise<{ storedEvents: number; firstEventAt: Date | null }> {
    return this.store.contribution(userId);
  }

  async ingest(
    userId: string,
    deviceTokenId: string,
    events: readonly IncomingEvent[],
    now: Date = new Date(),
    options: { gameRunning?: boolean } = {},
  ): Promise<IngestResult> {
    /*
     * Stamped BEFORE anything else, and independently of whether a single event
     * survives the filters. Presence is not a reward for sending us data — a
     * member who has consented to nothing but is sitting in a cockpit right now
     * should still show as playing.
     */
    if (options.gameRunning === true) {
      await this.store.markPlaying(userId, now).catch(() => undefined);
    }

    if (events.length > MAX_EVENTS_PER_REQUEST) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Too many events in one request (limit ${MAX_EVENTS_PER_REQUEST}).`,
      );
    }

    /*
     * ★ OPT-OUT: KEEP EVERYTHING EXCEPT WHAT THEY DECLINED (INV-013, amended) ★
     *
     * The app no longer filters. It sends what it reads, and THIS is where a
     * member's decision is applied — so this gate is the whole of their
     * privacy, not a second line behind one.
     *
     * Two scopes, and the finer one matters: somebody may be happy for us to
     * know they were in a conflict zone and not what bounties they claimed.
     * An event is discarded if EITHER its category or its own name is declined.
     *
     * `session` is never declinable. The service refuses to record it as an
     * opt-out, so it cannot arrive here as one — but the check below does not
     * special-case it, because a gate that trusts an upstream guarantee is a
     * gate that breaks when the guarantee moves.
     *
     * Refusals are counted and reported back rather than silently dropped: the
     * invariant is explicit that a declined event gets a clear answer, so the
     * app can say what was not stored instead of appearing to work while
     * sending into a void.
     */
    const optOut = await this.store.telemetryOptOuts(userId);
    const declinedCategories = new Set(optOut.categories);
    const declinedEvents = new Set(optOut.events);

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

      // The member declined this event by name.
      if (declinedEvents.has(e.name)) {
        refused[e.name] = (refused[e.name] ?? 0) + 1;
        continue;
      }

      // ...or the whole category it belongs to.
      if (declinedCategories.has(category)) {
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
