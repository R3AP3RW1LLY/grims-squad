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

/**
 * Applies a market event to the shared station price table.
 *
 * ★ SEPARATE FROM THE STORE, BECAUSE IT IS A DIFFERENT SUBJECT ★
 *
 * `IngestStore` writes what a MEMBER did. This writes what a STATION currently
 * sells — one row per station-commodity, shared by the whole squadron, read by
 * route-finding. Passing it in rather than reaching for a client keeps this
 * service testable without a database and lets the market side be absent
 * entirely, which is what the unit tests use.
 */
export interface MarketUpdater {
  apply(event: Record<string, unknown> & { event: string }): Promise<number>;
}

export interface IngestStore {
  /**
   * Whether this member lets their fleet be shown.
   *
   * ★ AN EXISTING PROMISE, HONOURED BY A NEW FEATURE ★
   *
   * Members set `showFleet` long before ship builds existed. The squadron owner chose automatic
   * import for everyone — and everyone who has not turned this off is exactly that. Somebody who
   * DID turn it off was told their ships would not be shown, and publishing their loadout
   * squadron-wide anyway would make that setting a lie.
   *
   * Defaults to true on any failure: the setting is an opt-OUT, and a database blip must not
   * silently start withholding data the member chose to share.
   */
  showsFleet(userId: string): Promise<boolean>;
  /**
   * Inserts, ignoring anything whose eventKey is already present.
   *
   * ★ RETURNS THE KEYS ACTUALLY INSERTED, NOT A COUNT ★
   *
   * It used to return the count, which was enough for the response and NOT
   * enough for live market updates: a `MarketBuy` of 794 tonnes that arrives
   * twice — which the companion does whenever an upload is retried — must not
   * subtract 794 twice. Only a genuinely new row may move a station's stock,
   * and only the keys can say which rows those were.
   */
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
  ): Promise<readonly string[]>;
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
   * Records that they have STOPPED playing, right now.
   *
   * ★ WHY AN EXPLICIT STOP AND NOT JUST LETTING IT AGE OUT ★
   *
   * Presence is "seen within the last five minutes", so without this a member
   * who quits keeps showing as Playing now for up to five minutes. Reported as
   * a bug, and fairly: the app KNOWS the moment the game closes, and sitting on
   * that for five minutes is a choice rather than a limitation.
   */
  markStopped(userId: string): Promise<void>;
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

/**
 * The events that move a station's market, and how.
 *
 * `Market` is a full snapshot and is safe to apply twice; the other two are
 * deltas and are not. See `newOnly` at the call site.
 */
const MARKET_EVENTS = new Set(['Market', 'MarketBuy', 'MarketSell']);

/**
 * The one thing this service needs in order to import a fitted ship.
 *
 * Structural rather than the concrete service, so telemetry does not depend on the AI module — and
 * so a test can pass a two-line fake instead of a ship catalogue.
 */
export interface LoadoutImporter {
  importLoadout(payload: unknown, userId: string): Promise<unknown>;
}

/**
 * Folds colonisation events into project records as they arrive.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "i have made several deliveries to the project, but they are not seeming to register."
 *
 * They were stored, and nothing was reading them: the only thing that converts a
 * `ColonisationContribution` into a ledger row was a job in the worker daemon, and the daemon was
 * not running. Applying it here means a delivery lands the moment it is uploaded, by the one
 * process that must be up for the upload to have happened at all.
 */
export interface ColonyApplier {
  /** Everything known about one construction site, re-derived. Never throws. */
  applyAt(marketId: bigint): Promise<void>;
}

/**
 * The two events that say anything about a construction site.
 *
 * The depot heartbeat carries what the site still needs; the contribution carries what somebody
 * just handed over. Either one changes what a project page should say, so either one is worth
 * applying immediately.
 */
const COLONY_EVENTS = new Set(['ColonisationConstructionDepot', 'ColonisationContribution']);

const DIGITS_ONLY = /^\d+$/;

/** `MarketID` out of a journal payload, or null when it is missing or unusable. */
function marketIdOf(payload: unknown): bigint | null {
  const raw = (payload as { MarketID?: unknown } | null)?.MarketID;
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return BigInt(raw);
  if (typeof raw === 'string' && DIGITS_ONLY.test(raw)) return BigInt(raw);
  return null;
}

export class JournalIngestService {
  constructor(
    private readonly store: IngestStore,
    /** Absent in unit tests, and in any deployment without the knowledge store. */
    private readonly market: MarketUpdater | null = null,
    /**
     * Imports a member's own ship from a `Loadout`.
     *
     * Optional for the same reason the market updater is: a unit test of ingestion should not need
     * the ship catalogue, and a deployment without it should still accept journals.
     */
    private readonly builds: LoadoutImporter | null = null,
    /**
     * Applies colonisation events to project records.
     *
     * Optional for the same reason the other two are: a unit test of ingestion should not need the
     * colonisation tables, and a deployment without it still accepts journals — the worker's
     * scheduled pass picks them up as it always did.
     */
    private readonly colony: ColonyApplier | null = null,
  ) {}

  /** How much this member has contributed in total. See `IngestStore`. */
  async contribution(userId: string): Promise<{ storedEvents: number; firstEventAt: Date | null }> {
    return this.store.contribution(userId);
  }

  async ingest(
    userId: string,
    deviceTokenId: string,
    events: readonly IncomingEvent[],
    now: Date = new Date(),
    options: { gameRunning?: boolean; gameStopped?: boolean } = {},
  ): Promise<IngestResult> {
    /*
     * Stamped BEFORE anything else, and independently of whether a single event
     * survives the filters. Presence is not a reward for sending us data — a
     * member who has consented to nothing but is sitting in a cockpit right now
     * should still show as playing.
     */
    if (options.gameRunning === true) {
      await this.store.markPlaying(userId, now).catch(() => undefined);
    } else if (options.gameStopped === true) {
      /*
       * ★ ONLY ON AN EXPLICIT STOP ★
       *
       * Not `else` — an ordinary upload with no `gameRunning` flag must not
       * clear presence. A batch arriving from a second machine, or a retry of
       * an old batch, would otherwise knock somebody offline mid-flight.
       *
       * The app sends this once, on the transition from playing to not, so it
       * is a statement about NOW rather than the absence of one.
       */
      await this.store.markStopped(userId).catch(() => undefined);
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
    /*
     * Market events, held with their key so they can be matched against what was
     * actually inserted. The RAW data is kept rather than the filtered payload:
     * `Market` carries the station's whole price list and `pickAllowedFields`
     * deliberately drops it, because that list belongs in `market_entries` and
     * not in a hundred and seven copies of a member's telemetry.
     */
    const marketEvents: Array<{ key: string; raw: Record<string, unknown> & { event: string } }> = [];
    /*
     * SITES, not events. A batch commonly carries twenty depot heartbeats for one construction site
     * — the game emits one every fifteen seconds — and each would re-derive the identical answer.
     * One pass per site is the same answer for a twentieth of the work.
     */
    const colonySites = new Set<bigint>();
    /** `Loadout` events, for importing the member's own ship. See the note below the insert. */
    const loadouts: Array<{ key: string; payload: unknown }> = [];
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

      // Ours, not the caller's. See eventKeyFor.
      const eventKey = eventKeyFor({ deviceTokenId, occurredAt, eventType: e.name, payload });

      rows.push({
        userId,
        deviceTokenId,
        category,
        eventType: e.name,
        occurredAt,
        payload,
        eventKey,
      });

      /*
       * Collected AFTER the opt-out gates, deliberately.
       *
       * A member who has switched off `trade` has said we may not have their
       * hauling, and quietly using it anyway because the result is anonymous
       * would make the setting a lie. Their trades simply do not reach the
       * market table — and the nightly dump still covers those stations.
       */
      if (this.market !== null && MARKET_EVENTS.has(e.name)) {
        marketEvents.push({ key: eventKey, raw: { ...e.data, event: e.name } });
      }

      // LoadGame is the one that proves they played. Collected per month so a
      // batch spanning a month boundary marks both.
      if (e.name === 'LoadGame') sessionMonths.add(monthKeyOf(occurredAt).getTime());

      /*
       * ★ THEIR ACTUAL SHIP — SQUADRON OWNER, 2026-08-01 ★
       *
       * Collected the same way market events are, and for the same reason: after the consent gates,
       * so a member who has switched a category off is not quietly harvested anyway.
       *
       * A `Loadout` is the strongest build we can hold — it is what is bolted to the hull, with the
       * engineering actually on it, rather than a plan somebody shared. The owner chose automatic
       * import for everyone.
       */
      if (e.name === 'Loadout') loadouts.push({ key: eventKey, payload });

      /*
       * Colonisation, collected after the consent gates like everything else. A member who has
       * switched the category off contributes nothing to a project — which is the correct behaviour
       * and not a special case, because the events never reach the table either.
       */
      if (this.colony !== null && COLONY_EVENTS.has(e.name)) {
        const marketId = marketIdOf(payload);
        if (marketId !== null) colonySites.add(marketId);
      }
    }

    const insertedKeys = rows.length === 0 ? [] : await this.store.insertIgnoringDuplicates(rows);
    const accepted = insertedKeys.length;

    /*
     * ★ LIVE MARKET UPDATES, AND ONLY FROM EVENTS THAT WERE GENUINELY NEW ★
     *
     * The companion retries a failed batch, so the same MarketBuy can arrive
     * more than once. Applying a delta per ARRIVAL rather than per new row
     * would subtract the same 794 tonnes twice and report a station as empty
     * that is not — worse than the stale figure this replaces.
     *
     * `Market` is filtered the same way even though a snapshot is idempotent: a
     * re-sent one is an OLD snapshot, and replaying it over a newer reading
     * would move the table backwards.
     */
    if (this.market !== null && marketEvents.length > 0) {
      const isNew = new Set(insertedKeys);
      for (const m of marketEvents) {
        if (!isNew.has(m.key)) continue;
        /*
         * Awaited but never allowed to throw. A member's upload must succeed
         * whether or not we could place their market — the events are stored
         * either way, and a station we have not ingested yet is a normal
         * result rather than a failure.
         */
        await this.market.apply(m.raw).catch(() => 0);
      }
    }

    /*
     * ★ SHIP BUILDS, FROM GENUINELY NEW LOADOUTS ONLY ★
     *
     * The companion retries a failed batch, so the same `Loadout` can arrive more than once.
     * Re-importing costs a decode and a write that changes nothing, which is harmless but pointless
     * — and doing it per ARRIVAL rather than per new row would rewrite a member's ship every time
     * their app retried.
     *
     * ★ AND IT RESPECTS THE FLEET PRIVACY TOGGLE ★
     *
     * The owner chose automatic import for everyone. Members already have a `showFleet` setting
     * that governs whether their ships are shown to anybody, and they set it before this feature
     * existed — publishing their loadout squadron-wide regardless would break a promise the site
     * had already made them. Somebody who has turned it off keeps their ships private; everybody
     * else, which is the default, is imported automatically as asked.
     */
    if (this.builds !== null && loadouts.length > 0) {
      const isNew = new Set(insertedKeys);
      const mayShare = await this.store.showsFleet(userId).catch(() => true);

      if (mayShare) {
        for (const l of loadouts) {
          if (!isNew.has(l.key)) continue;
          /*
           * Never allowed to throw. A member's upload must succeed whether or not we could read
           * their ship — a hull we lack data for is a normal result, not a failure of their send.
           */
          await this.builds.importLoadout(l.payload, userId).catch(() => null);
        }
      }
    }

    /*
     * ★ COLONISATION, APPLIED PER SITE AND NOT PER NEW ROW ★
     *
     * Deliberately NOT filtered to `insertedKeys`, unlike the market and loadout hooks above. Those
     * apply a DELTA, so replaying one double-counts. This re-derives a site's whole state from
     * every event ever stored for it — needs are replaced wholesale and the ledger is keyed unique
     * — so a repeat run is free, and running it on a retried batch is how a delivery that arrived
     * before anybody had posted the project finally lands.
     */
    if (this.colony !== null) {
      for (const marketId of colonySites) {
        await this.colony.applyAt(marketId);
      }
    }

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
