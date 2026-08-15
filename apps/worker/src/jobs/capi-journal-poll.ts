import { createHash } from 'node:crypto';
import {
  canonicalJson,
  categoryOf,
  initialPoll,
  isAllowedEvent,
  nextPoll,
  pickAllowedFields,
  type PollState,
} from '@grims/shared';
import { CapiAuthError, fetchJournalDay, type JournalDay } from '@grims/ed-clients';

/**
 * The journal poller — the GeForce Now unlock.
 *
 * ★ SQUADRON OWNER, 2026-08-15 ★
 *
 * "the primary feature must be so that players that are playing on Geforce Now and cloud platforms
 * can use the companion app like everyone else"
 *
 * A commander on a cloud platform cannot run anything beside the game: no journal folder, no
 * process, nothing to install. Frontier serves their journal anyway, so this is the only way they
 * exist here at all. Fetching is four lines; the four things below are the job, and each has a
 * named prior incident in this repository behind it.
 *
 * ★ 1. IDEMPOTENCE ★
 *
 * The same day is re-fetched every sixty seconds and is almost entirely entries we already hold. A
 * second copy of one ColonisationContribution is a delivery counted twice on a board the squadron
 * plans real hauling runs from — and it is invisible, because both rows are individually correct.
 *
 * Two defences, because they catch different things. `event_key` is the API's own key (INV-017) and
 * the unique index refuses a repeat outright. The content FINGERPRINT catches the same journal line
 * arriving under a different device — the member whose companion already uploaded it — which the
 * key cannot see, because it is namespaced by device on purpose.
 *
 * ★ 2. PACING ★
 *
 * Frontier's limit is per CLIENT ID, across every member at once. Requests are serialised, spaced,
 * and capped per run; a 429 abandons the WHOLE run, because the budget is the squadron's and
 * marching through the rest spends an exhausted limit proving it is exhausted.
 *
 * ★ 3. DEAD GRANTS ★
 *
 * Past Frontier's 25-day ceiling a member must STOP being polled. A retry loop around a dead token
 * is a member disconnected in silence, and every attempt is spent from everybody's budget.
 *
 * ★ 4. CONSENT ★
 *
 * This is a SECOND DOOR into `telemetry_events`, and INV-013 is enforced at the door. cAPI hands
 * over the whole journal — including every event the companion deliberately never sends — so
 * without the same allowlist the API applies on receipt, the cloud route would collect strictly
 * more about a member than the desktop one. That is the reverse of what everybody was promised.
 *
 * ★ AND IT WRITES WHAT PROMOTIONS READ ★
 *
 * Game activity sat at `unknown` for most of the squadron because the only thing that ever set it
 * was the companion's ingest — so a cloud player could never earn a qualifying month however much
 * they flew. `markGameActivityObserved` is the line that changes that.
 */

/** The floor between two requests. The limit is shared, so this is the squadron's pacing. */
export const CAPI_MIN_SPACING_MS = 1_100;

/**
 * The most requests one run will make.
 *
 * A cap, not a queue. Without it one run over a large squadron consumes the whole limit and the
 * NEXT run — carrying the members who are actually flying — is refused. The cap makes the failure
 * "some members are late", which the report says out loud, instead of "everybody stops", which
 * nothing says at all.
 */
export const MAX_REQUESTS_PER_RUN = 40;

export interface PollableMember {
  readonly userId: string;
  readonly cmdrName: string;
}

export interface MemberPollState {
  readonly poll: PollState;
  /** When this member is next due. */
  readonly dueAt: Date;
  /** The newest entry we have stored. The next poll skips everything before it. */
  readonly watermark: Date | null;
  /** The last day already read to completion, so a finished day is never re-read. */
  readonly closedDay: string | null;
}

export interface TelemetryRow {
  readonly userId: string;
  readonly deviceTokenId: string;
  readonly eventKey: string;
  readonly eventType: string;
  readonly category: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface CapiPollStore {
  livePollable(): Promise<readonly PollableMember[]>;
  readState(userId: string): Promise<MemberPollState | null>;
  writeState(userId: string, state: MemberPollState): Promise<void>;
  /** Null when the grant is dead. Marking it stale is the store's job, not ours. */
  accessToken(userId: string): Promise<string | null>;
  /** The synthetic device cAPI rows are attributed to. Null when the member revoked it. */
  frontierDeviceToken(userId: string): Promise<string | null>;
  optOuts(userId: string): Promise<{ categories: readonly string[]; events: readonly string[] }>;
  /** Fingerprints already held for this member, whatever device wrote them. */
  fingerprintsSince(userId: string, since: Date): Promise<ReadonlySet<string>>;
  /** Returns the keys actually stored — the unique index decides, not us. */
  insert(rows: readonly TelemetryRow[]): Promise<readonly string[]>;
  markPlaying(userId: string, at: Date): Promise<void>;
  markGameActivityObserved(userId: string, month: Date): Promise<void>;
}

/**
 * INV-017's key — the API's formula, character for character.
 *
 * ★ WHY THIS IS DUPLICATED AND WHY THAT IS WATCHED ★
 *
 * The worker cannot import from the API, so this hash exists twice. Two implementations of one hash
 * is exactly the arrangement that drifts, and the symptom of drift is every cAPI entry re-stored on
 * every poll for ever, with no error anywhere. The spec beside this file reads the API's source and
 * asserts the term order, so a reordering there fails HERE — the only place that would notice.
 *
 * Nothing in it derives from when we asked. A key that moved with the fetch would differ on every
 * poll and defeat the unique index entirely, which is the whole failure this file exists to avoid.
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

/**
 * The same journal line, whichever device reported it.
 *
 * Deliberately WITHOUT the device. That omission is the entire point: the same FSDJump uploaded by
 * a member's companion and fetched from Frontier's copy hashes to two different event keys and
 * inserts twice, and the colonisation ledger keys on the telemetry event key — so the project total
 * ends up wrong by one delivery. This is what makes "local wins, cAPI backfills the gaps" true
 * rather than "local wins, cAPI duplicates".
 */
export function contentFingerprint(input: {
  occurredAt: Date;
  eventType: string;
  payload: Record<string, unknown>;
}): string {
  return createHash('sha256')
    .update(`${input.occurredAt.toISOString()}|${input.eventType}|${canonicalJson(input.payload)}`)
    .digest('hex');
}

export interface PollOptions {
  readonly now: Date;
  /** Default FALSE. Reaching a live API and writing the table every member-facing number comes
   *  from is not something a job should do because it was run. */
  readonly live?: boolean | undefined;
  readonly apiBase: string;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly maxRequests?: number | undefined;
  /** How often this job runs. Sets the due-horizon — see the note at the filter. */
  readonly tickMs?: number | undefined;
}

/** The job's own cadence, matching the fastest interval a member can reach. */
const DEFAULT_TICK_MS = 60_000;

export interface MemberOutcome {
  readonly userId: string;
  readonly stored: number;
  /** Entries we already held — by key or by fingerprint. Expected to be most of them. */
  readonly duplicates: number;
  /** Entries dropped because the member declined that category or event name. */
  readonly refused: number;
  /** Entries dropped because they are not on the allowlist at all, or are impossible. */
  readonly rejected: number;
  /** The day's last line was torn mid-write. Expected on the current day; not a fault. */
  readonly partialTail: boolean;
  /** Why no request was made for this member, or null when one was. */
  readonly skipped: string | null;
}

export interface PollReport {
  readonly live: boolean;
  readonly asked: number;
  readonly stored: number;
  /** Members who were due and did not fit under the cap. They lead the next run. */
  readonly deferred: number;
  /** The run stopped early — the shared budget is gone. */
  readonly abandoned: boolean;
  readonly note: string | null;
  readonly members: readonly MemberOutcome[];
}

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function pollCapiJournals(
  store: CapiPollStore,
  opts: PollOptions,
): Promise<PollReport> {
  const sleep = opts.sleep ?? wait;
  const live = opts.live ?? false;
  const cap = opts.maxRequests ?? MAX_REQUESTS_PER_RUN;

  const members = await store.livePollable();
  const withState = await Promise.all(
    members.map(async (m) => ({ member: m, state: await store.readState(m.userId) })),
  );

  /*
   * ★ DUE NOW, OR DUE BEFORE WE RUN AGAIN ★
   *
   * The job itself ticks. A member whose `dueAt` falls between this run and the next is served now,
   * because the alternative is serving them a whole tick late — and doing that every cycle is how a
   * sixty-second cadence silently becomes a two-minute one for everybody at once.
   */
  const horizon = opts.now.getTime() + (opts.tickMs ?? DEFAULT_TICK_MS);

  const due = withState
    .filter(({ state }) => state === null || state.dueAt.getTime() <= horizon)
    /*
     * ★ THE ORDER IS THE FAIRNESS ★
     *
     * With a per-run cap, polling in whatever order the database returned would let the same
     * members fall off the end of every run for ever — and they would simply appear to have
     * stopped playing. Most overdue first; a member with no state at all has never been polled.
     */
    .sort((a, b) => (a.state?.dueAt.getTime() ?? 0) - (b.state?.dueAt.getTime() ?? 0));

  const serving = due.slice(0, cap);
  const outcomes: MemberOutcome[] = [];
  let asked = 0;
  let storedTotal = 0;
  let abandoned = false;
  let note: string | null = null;

  for (const { member, state } of serving) {
    const token = await store.accessToken(member.userId);
    if (token === null) {
      /*
       * Past the 25-day ceiling. NOT an error and NOT a retry: `accessToken` has already marked the
       * row stale, which takes the member out of `livePollable` next run, and the app asks them to
       * reconnect. Spending a request here would take it from every other member's budget.
       */
      outcomes.push(skip(member.userId, 'the Frontier link expired — the member must reconnect'));
      continue;
    }

    const deviceTokenId = await store.frontierDeviceToken(member.userId);
    if (deviceTokenId === null) {
      // Revoking the synthetic device is a member saying "stop importing this". Honouring it here
      // is what makes that a real control rather than a button that does nothing.
      outcomes.push(skip(member.userId, 'the member revoked the Frontier feed'));
      continue;
    }

    if (asked > 0) {
      // Serialised, with a floor. The first request pays nothing — a run that sleeps before doing
      // anything is a run that is always a second late for no reason.
      await sleep(CAPI_MIN_SPACING_MS);
    }
    asked += 1;

    let day: JournalDay;
    try {
      day = await fetchJournalDay({
        apiBase: opts.apiBase,
        accessToken: token,
        day: opts.now,
        fetchImpl: opts.fetchImpl,
      });
    } catch (e) {
      if (e instanceof CapiAuthError && e.kind === 'rate_limited') {
        /*
         * ★ THE WHOLE RUN STOPS ★
         *
         * The budget is shared, so a 429 is a statement about the squadron and not about the member
         * who happened to be next. Frontier is documented to extend a ban for exactly the behaviour
         * of continuing — and the members not yet reached keep their `dueAt`, so they lead the next
         * run rather than losing their place.
         */
        abandoned = true;
        note = 'Frontier rate limited us — the run stopped rather than spend an exhausted budget.';
        break;
      }

      if (e instanceof CapiAuthError && e.kind === 'invalid_grant') {
        // One member's grant dying says nothing about anybody else's. Abandoning over it would let
        // one lapsed member stop the entire squadron's data.
        outcomes.push(skip(member.userId, 'Frontier refused the token — the member must reconnect'));
        continue;
      }

      /*
       * A failed FETCH measured nothing. The cadence measures how fast FRONTIER WRITES the journal,
       * so feeding this in as "no new entries" would walk an actively flying member out to the idle
       * interval because Frontier had a bad minute. The interval is held exactly where it was.
       */
      const held = state?.poll ?? initialPoll();
      if (live) {
        await store.writeState(member.userId, {
          poll: held,
          dueAt: new Date(opts.now.getTime() + held.intervalMs),
          watermark: state?.watermark ?? null,
          closedDay: state?.closedDay ?? null,
        });
      }
      outcomes.push({
        ...skip(member.userId, `Frontier was unreachable: ${(e as Error).message}`),
      });
      continue;
    }

    const optOuts = await store.optOuts(member.userId);
    const watermark = state?.watermark ?? null;

    const rows: TelemetryRow[] = [];
    let refused = 0;
    let rejected = 0;

    for (const entry of day.entries) {
      /*
       * ★ THE WATERMARK DOES NOT FILTER HERE, ON PURPOSE ★
       *
       * The obvious optimisation — skip anything at or before the watermark — is wrong twice. It
       * would make `duplicates` read zero, and that number is the only signal that Frontier is
       * serving us bytes we already hold; the cadence exists to act on it. And it assumes Frontier
       * only ever appends, when in practice they regenerate the file, so an entry can appear
       * BEHIND the watermark and would be lost for ever without a single error.
       *
       * Dedup is the guarantee, and it is exact. The watermark's job is choosing which DAY to read
       * and how far back to ask for fingerprints, not deciding what counts.
       */
      if (entry.occurredAt.getTime() > opts.now.getTime()) {
        // A broken clock, or an attempt to bank activity for a month that has not happened. The API
        // refuses these on receipt and so does this door.
        rejected += 1;
        continue;
      }

      if (!isAllowedEvent(entry.event)) {
        // Everything the companion deliberately never sends. Without this the cloud route would
        // collect strictly more about a member than the desktop one.
        rejected += 1;
        continue;
      }

      const category = categoryOf(entry.event);
      if (
        category === null ||
        optOuts.categories.includes(category) ||
        optOuts.events.includes(entry.event)
      ) {
        // INV-013. A member switched this off having been told what it means; collecting it anyway
        // because it arrived by a different route would make the setting a lie nobody discovers.
        refused += 1;
        continue;
      }

      // The same fields the API keeps, from the same table. `Credits` rides on LoadGame and is not
      // among them.
      const payload = pickAllowedFields(entry.event, entry.data);

      rows.push({
        userId: member.userId,
        deviceTokenId,
        eventKey: eventKeyFor({
          deviceTokenId,
          occurredAt: entry.occurredAt,
          eventType: entry.event,
          payload,
        }),
        eventType: entry.event,
        category,
        occurredAt: entry.occurredAt,
        payload,
      });
    }

    /*
     * The cross-device pass — the one the event key cannot do. Every PC member is told to link
     * Frontier (the owner made it mandatory) and most of them also run the companion, so without
     * this their whole day would be stored twice.
     */
    /*
     * The start of the day we just read — not the watermark. Asking from the watermark would miss
     * the fingerprint of anything earlier in the same file, and every one of those would look fresh.
     */
    const since = new Date(
      Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate()),
    );
    const known = await store.fingerprintsSince(member.userId, since);
    const fresh = rows.filter((r) => !known.has(contentFingerprint(r)));

    const storedKeys = live && fresh.length > 0 ? await store.insert(fresh) : [];
    const stored = live ? storedKeys.length : fresh.length;
    storedTotal += stored;

    const newest = rows.reduce<Date | null>(
      (acc, r) => (acc === null || r.occurredAt > acc ? r.occurredAt : acc),
      null,
    );

    if (live) {
      if (stored > 0 && newest !== null) {
        /*
         * ★ THE ENTRY'S TIME, NEVER OURS ★
         *
         * cAPI lags by however long Frontier takes to publish. Stamping `now` would show a member
         * as "playing now" on the strength of an entry written twenty minutes ago — the platform
         * asserting something it does not know, which is the failure this codebase keeps
         * rediscovering under different names.
         */
        await store.markPlaying(member.userId, newest);
        await store.markGameActivityObserved(
          member.userId,
          new Date(Date.UTC(newest.getUTCFullYear(), newest.getUTCMonth(), 1)),
        );
      }

      /*
       * `changed` is "entries that were new TO US", not "the response differed". Deliberate: a
       * member whose companion already sends everything produces a response full of entries we
       * hold, and that request is precisely the one not worth making — so they walk out to the idle
       * interval on their own, with no rule anywhere refusing anybody.
       */
      const poll = nextPoll(state?.poll ?? initialPoll(), stored > 0, opts.now);
      await store.writeState(member.userId, {
        poll,
        dueAt: new Date(opts.now.getTime() + poll.intervalMs),
        watermark: newest ?? watermark,
        closedDay: state?.closedDay ?? null,
      });
    }

    outcomes.push({
      userId: member.userId,
      stored,
      duplicates: rows.length - fresh.length + (fresh.length - storedKeys.length) * (live ? 1 : 0),
      refused,
      rejected,
      partialTail: day.partialTail,
      skipped: null,
    });
  }

  return {
    live,
    asked,
    stored: storedTotal,
    deferred: due.length - serving.length,
    abandoned,
    note,
    members: outcomes,
  };
}

const skip = (userId: string, why: string): MemberOutcome => ({
  userId,
  stored: 0,
  duplicates: 0,
  refused: 0,
  rejected: 0,
  partialTail: false,
  skipped: why,
});
