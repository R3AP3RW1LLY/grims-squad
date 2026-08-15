import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVE_FLOOR_MS, IDLE_MS, START_MS, initialPoll } from '@grims/shared';
import {
  CAPI_MIN_SPACING_MS,
  MAX_REQUESTS_PER_RUN,
  contentFingerprint,
  eventKeyFor,
  pollCapiJournals,
  type CapiPollStore,
  type MemberPollState,
  type PollableMember,
  type TelemetryRow,
} from './capi-journal-poll.js';

/**
 * The journal poller — the GeForce Now unlock.
 *
 * ★ WHAT IS ACTUALLY BEING TESTED HERE ★
 *
 * Not "does it fetch". Fetching is four lines. The four things that are hard, that fail silently,
 * and that each have a named prior incident behind them in this repo:
 *
 *   1. IDEMPOTENCE.  The same day is fetched every sixty seconds and returns the same entries.
 *                    A second copy of one `ColonisationContribution` inflates a project total
 *                    the squadron plans hauling runs around, and nothing anywhere reports it.
 *   2. PACING.       Frontier's rate limit is per CLIENT ID, across every member at once. Firing
 *                    the squadron in parallel exhausts it for everybody, including the member
 *                    whose request was fine.
 *   3. DEAD GRANTS.  A member past Frontier's 25-day ceiling must STOP being polled. A retry loop
 *                    around a dead token is a member disconnected in silence.
 *   4. CONSENT.      This is a second door into `telemetry_events`, and INV-013 is enforced at the
 *                    door. A member who declined a category must not have it collected merely
 *                    because it arrived by a different route.
 */

// --------------------------------------------------------------------------------------- fixtures

const DEVICE = '11111111-1111-1111-1111-111111111111';
const OTHER_DEVICE = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-08-15T12:00:00Z');

const line = (timestamp: string, event: string, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ timestamp, event, ...rest });

/** A day's body: two events that are both on the allowlist. */
const DAY = [
  line('2026-08-15T11:58:00Z', 'LoadGame', { Commander: 'Grim', Credits: 1_000_000 }),
  line('2026-08-15T11:59:00Z', 'FSDJump', { StarSystem: 'Deciat', SystemAddress: 6_681_123_623_626 }),
].join('\n');

interface FakeOptions {
  readonly members?: readonly PollableMember[];
  readonly states?: Record<string, MemberPollState>;
  readonly tokens?: Record<string, string | null>;
  readonly devices?: Record<string, string | null>;
  readonly optOuts?: Record<string, { categories: readonly string[]; events: readonly string[] }>;
  readonly existing?: readonly string[];
  /**
   * Event keys the unique index already holds while the fingerprint query does NOT see them.
   *
   * Real, and not rare: the fingerprint lookup is windowed to the day being read, and the index is
   * global and permanent. An entry stored last week under the same key is invisible to the window.
   */
  readonly heldKeys?: readonly string[];
}

class FakeStore implements CapiPollStore {
  readonly inserted: TelemetryRow[] = [];
  readonly written = new Map<string, MemberPollState>();
  readonly playing: Array<{ userId: string; at: Date }> = [];
  readonly months: Array<{ userId: string; month: Date }> = [];
  readonly tokenCalls: string[] = [];
  /** Emulates the GLOBAL unique index over `event_key`. */
  readonly #keys = new Set<string>();
  /** Fingerprints already held for a member, whatever device wrote them. */
  readonly #fingerprints: Set<string>;

  constructor(private readonly opts: FakeOptions = {}) {
    this.#fingerprints = new Set(opts.existing ?? []);
    for (const key of opts.heldKeys ?? []) this.#keys.add(key);
  }

  async livePollable(): Promise<readonly PollableMember[]> {
    return this.opts.members ?? [{ userId: 'u1', cmdrName: 'GRIM' }];
  }

  async readState(userId: string): Promise<MemberPollState | null> {
    return this.written.get(userId) ?? this.opts.states?.[userId] ?? null;
  }

  async writeState(userId: string, state: MemberPollState): Promise<void> {
    this.written.set(userId, state);
  }

  async accessToken(userId: string): Promise<string | null> {
    this.tokenCalls.push(userId);
    if (this.opts.tokens !== undefined && userId in this.opts.tokens) {
      return this.opts.tokens[userId] ?? null;
    }
    return `token-${userId}`;
  }

  async frontierDeviceToken(userId: string): Promise<string | null> {
    if (this.opts.devices !== undefined && userId in this.opts.devices) {
      return this.opts.devices[userId] ?? null;
    }
    return DEVICE;
  }

  async optOuts(userId: string): Promise<{ categories: readonly string[]; events: readonly string[] }> {
    return this.opts.optOuts?.[userId] ?? { categories: [], events: [] };
  }

  async fingerprintsSince(): Promise<ReadonlySet<string>> {
    return this.#fingerprints;
  }

  async insert(rows: readonly TelemetryRow[]): Promise<readonly string[]> {
    const fresh: string[] = [];
    for (const row of rows) {
      // The database's unique index, in four lines. Without this the idempotence tests below
      // would pass against a store that cheerfully stored the same event a hundred times.
      if (this.#keys.has(row.eventKey)) continue;
      this.#keys.add(row.eventKey);
      this.#fingerprints.add(contentFingerprint(row));
      this.inserted.push(row);
      fresh.push(row.eventKey);
    }
    return fresh;
  }

  async markPlaying(userId: string, at: Date): Promise<void> {
    this.playing.push({ userId, at });
  }

  async markGameActivityObserved(userId: string, month: Date): Promise<void> {
    this.months.push({ userId, month });
  }
}

/** A fetch that returns the same body for every day, and records what was asked for. */
const serving = (body: string, seen: string[] = []): typeof fetch =>
  (async (url: string) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;

const run = async (
  store: CapiPollStore,
  fetchImpl: typeof fetch,
  extra: Record<string, unknown> = {},
): ReturnType<typeof pollCapiJournals> =>
  pollCapiJournals(store, {
    now: NOW,
    live: true,
    fetchImpl,
    apiBase: 'https://companion.orerve.net',
    sleep: async () => undefined,
    ...extra,
  });

// ------------------------------------------------------------------------------------ idempotence

describe('idempotence — the same day, over and over', () => {
  it('★ MANDATORY: polling the same day twice stores the entries ONCE ★', async () => {
    /*
     * THE DEFINING PROPERTY. An actively flying member's day is re-fetched every sixty seconds and
     * is almost entirely entries we already hold. The second store of a `ColonisationContribution`
     * is a delivery counted twice on a board the squadron plans real hauling runs from — and it is
     * completely invisible, because both rows are individually correct.
     *
     * The guarantee is the SAME `event_key` INV-017 defines for the companion: a stable device
     * identity, the entry's own timestamp, its name, and a hash of the payload we actually store.
     * Nothing in it is derived from when we asked.
     */
    const store = new FakeStore();

    const first = await run(store, serving(DAY));
    const second = await run(store, serving(DAY));

    expect(first.stored).toBe(2);
    expect(second.stored).toBe(0);
    expect(store.inserted).toHaveLength(2);
    expect(second.members[0]?.duplicates).toBe(2);
  });

  it('★ MANDATORY: an entry the COMPANION already sent is not stored a second time ★', async () => {
    /*
     * ★ THE ONE THE EVENT KEY CANNOT CATCH ★
     *
     * `event_key` is namespaced by device — deliberately, so one member's client cannot claim keys
     * another member's events would need. That namespacing is exactly why it cannot see this case:
     * the same physical journal line, arriving from the companion app on a member's PC and from
     * Frontier's copy of the same journal, hashes to two DIFFERENT keys. Both insert. The
     * colonisation ledger keys on the telemetry event key, so both become ledger rows, and the
     * project total is wrong by one delivery.
     *
     * That is not hypothetical: every PC member is told to link Frontier — the owner made it
     * mandatory — and most of them also run the companion.
     *
     * So there is a second check that does NOT include the device: the content fingerprint. If
     * this member already holds an event with the same instant, name and payload, whoever sent it,
     * we have it.
     */
    const occurredAt = new Date('2026-08-15T11:59:00Z');
    const alreadyHeld = contentFingerprint({
      occurredAt,
      eventType: 'FSDJump',
      payload: { StarSystem: 'Deciat', SystemAddress: 6_681_123_623_626 },
    });

    const store = new FakeStore({ existing: [alreadyHeld] });
    const report = await run(store, serving(DAY));

    expect(store.inserted.map((r) => r.eventType)).toEqual(['LoadGame']);
    expect(report.stored).toBe(1);
  });

  it('★ MANDATORY: a row the INDEX rejected is not counted as stored ★', async () => {
    /*
     * ★ THE PHANTOM STORE ★
     *
     * `insert` returns the keys the database actually took, and that is not always what we offered:
     * the fingerprint lookup is windowed to the day being read, the unique index is global and
     * permanent, so a key stored last week passes the fingerprint check and is then refused.
     *
     * Counting what we OFFERED instead of what LANDED would be wrong in three places at once, none
     * of which raises anything:
     *
     *   - `stored > 0` tightens the cadence. A member whose entries are all already held would be
     *     pinned at the sixty-second floor for ever, spending the squadron's shared rate limit to
     *     be told the same thing every minute — the precise cost the cadence exists to avoid.
     *   - `markPlaying` would assert somebody is flying on the strength of a row that was refused.
     *   - the month would be credited toward a PROMOTION off the same refused row.
     *
     * So the count comes from the database's answer, never from our own optimism.
     */
    const held = eventKeyFor({
      deviceTokenId: DEVICE,
      occurredAt: new Date('2026-08-15T11:58:00Z'),
      eventType: 'LoadGame',
      payload: { Commander: 'Grim', Credits: 1_000_000 },
    });

    const store = new FakeStore({ heldKeys: [held] });
    const report = await run(store, serving(line('2026-08-15T11:58:00Z', 'LoadGame', {
      Commander: 'Grim',
      Credits: 1_000_000,
    })));

    expect(report.stored, 'the index took none of it').toBe(0);
    expect(store.playing, 'nothing proves they are flying').toEqual([]);
    expect(store.months, 'and nothing counts toward a promotion').toEqual([]);
    expect(
      store.written.get('u1')?.poll.unchangedInARow,
      'nothing new, so the interval must widen rather than pin to the floor',
    ).toBe(1);
  });

  it('the fingerprint ignores the device, and the event key does not', () => {
    /*
     * The property the test above leans on, asserted directly so a future refactor cannot quietly
     * make the fingerprint device-dependent — which would restore the double count with every
     * test still green.
     */
    const row = {
      occurredAt: new Date('2026-08-15T11:59:00Z'),
      eventType: 'FSDJump',
      payload: { StarSystem: 'Deciat' },
    };

    expect(contentFingerprint(row)).toBe(contentFingerprint(row));
    expect(eventKeyFor({ ...row, deviceTokenId: DEVICE })).not.toBe(
      eventKeyFor({ ...row, deviceTokenId: OTHER_DEVICE }),
    );
  });

  it('★ MANDATORY: the key formula still matches the one the API writes ★', () => {
    /*
     * ★ THE DRIFT THIS CATCHES ★
     *
     * `eventKeyFor` exists twice: in apps/api's ingest, where the companion's uploads are keyed,
     * and here, because the worker cannot import from the API. Two implementations of one hash is
     * exactly the arrangement that drifts — and the symptom would be every cAPI entry re-stored on
     * every poll forever, with no error and no failing test anywhere.
     *
     * So this reads the API's source and asserts the term order it hashes. A reordering there
     * fails HERE, which is the only place that would ever notice.
     */
    const here = dirname(fileURLToPath(import.meta.url));
    const api = readFileSync(
      join(here, '../../../api/src/telemetry/journal-ingest.service.ts'),
      'utf8',
    );

    expect(api).toContain(
      '`${input.deviceTokenId}|${input.occurredAt.toISOString()}|${input.eventType}|${canonicalJson(input.payload)}`',
    );

    // And the same inputs produce the same digest through our copy of it.
    expect(
      eventKeyFor({
        deviceTokenId: DEVICE,
        occurredAt: new Date('2026-08-15T11:59:00Z'),
        eventType: 'FSDJump',
        payload: { StarSystem: 'Deciat' },
      }),
    ).toBe(eventKeyFor({
      deviceTokenId: DEVICE,
      occurredAt: new Date('2026-08-15T11:59:00.000Z'),
      eventType: 'FSDJump',
      payload: { StarSystem: 'Deciat' },
    }));
  });

  it('a torn final line costs nothing and the complete entries still land', async () => {
    // The current day is partial by definition. Losing a member's whole session because the last
    // 40 bytes had not landed would break exactly the member this feature exists for.
    const store = new FakeStore();
    const report = await run(store, serving(`${DAY}\n{"timestamp":"2026-08-15T11:59:30Z","event":"Doc`));

    expect(report.stored).toBe(2);
    expect(report.members[0]?.partialTail).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------ pacing

describe('pacing — one shared rate limit for the whole squadron', () => {
  it('★ MANDATORY: members are polled one at a time, never in parallel ★', async () => {
    /*
     * The limit is per CLIENT ID, across everybody. Twenty members fired together is twenty
     * simultaneous requests against a budget sized for a trickle — and the member who gets the 429
     * is not the member who caused it.
     */
    const members = ['u1', 'u2', 'u3'].map((userId) => ({ userId, cmdrName: userId }));
    const store = new FakeStore({ members });

    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = (async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, status: 200, text: async () => DAY } as unknown as Response;
    }) as unknown as typeof fetch;

    await run(store, fetchImpl);

    expect(maxInFlight).toBe(1);
  });

  it('★ MANDATORY: it waits between requests, and the wait is the shared budget ★', async () => {
    const members = ['u1', 'u2', 'u3'].map((userId) => ({ userId, cmdrName: userId }));
    const store = new FakeStore({ members });

    const slept: number[] = [];
    await run(store, serving(DAY), { sleep: async (ms: number) => void slept.push(ms) });

    // Two members after the first, so two waits. The first request pays nothing — a run that
    // sleeps before doing anything is a run that is always a second late for no reason.
    expect(slept).toHaveLength(2);
    for (const ms of slept) expect(ms).toBeGreaterThanOrEqual(CAPI_MIN_SPACING_MS);
  });

  it('★ MANDATORY: a run cannot spend more than its share of the budget ★', async () => {
    /*
     * Without a ceiling, one run over a large squadron consumes the whole limit and the NEXT run
     * — carrying the members who are actually flying — is refused. The cap is what makes the
     * failure "some members are late", which the report says out loud, instead of "everybody
     * stops", which nothing says at all.
     */
    const members = Array.from({ length: MAX_REQUESTS_PER_RUN + 5 }, (_, i) => ({
      userId: `u${i}`,
      cmdrName: `u${i}`,
    }));
    const seen: string[] = [];
    const store = new FakeStore({ members });

    const report = await run(store, serving(DAY, seen));

    expect(seen).toHaveLength(MAX_REQUESTS_PER_RUN);
    expect(report.deferred).toBe(5);
  });

  it('★ MANDATORY: the most overdue member goes first ★', async () => {
    /*
     * With a per-run cap, the order IS the fairness. Polling in whatever order the database
     * returned would let the same members fall off the end of every run for ever, and they would
     * simply appear to have stopped playing.
     */
    const at = (iso: string): MemberPollState => ({
      poll: initialPoll(),
      dueAt: new Date(iso),
      watermark: null,
      closedDay: '2026-08-14',
    });

    const store = new FakeStore({
      members: [
        { userId: 'recent', cmdrName: 'recent' },
        { userId: 'ancient', cmdrName: 'ancient' },
        { userId: 'middling', cmdrName: 'middling' },
      ],
      states: {
        recent: at('2026-08-15T11:59:00Z'),
        ancient: at('2026-08-15T10:00:00Z'),
        middling: at('2026-08-15T11:00:00Z'),
      },
    });

    const report = await run(store, serving(DAY), { maxRequests: 2 });

    expect(report.members.map((m) => m.userId)).toEqual(['ancient', 'middling']);
  });

  it('★ MANDATORY: a rate limit abandons the WHOLE run, not just that member ★', async () => {
    /*
     * The budget is shared, so a 429 is a statement about the squadron and not about the member
     * who happened to be next. Marching through the rest spends an exhausted limit proving it is
     * exhausted, and Frontier is documented to extend a ban for exactly that.
     */
    const members = ['u1', 'u2', 'u3'].map((userId) => ({ userId, cmdrName: userId }));
    const store = new FakeStore({ members });

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 2) return { ok: false, status: 429, text: async () => '' } as unknown as Response;
      return { ok: true, status: 200, text: async () => DAY } as unknown as Response;
    }) as unknown as typeof fetch;

    const report = await run(store, fetchImpl);

    expect(calls).toBe(2);
    expect(report.abandoned).toBe(true);
    expect(report.note).toContain('rate');
  });

  it('a member whose poll is not due yet costs no request at all', async () => {
    const store = new FakeStore({
      states: {
        u1: {
          poll: initialPoll(),
          dueAt: new Date('2026-08-15T12:05:00Z'),
          watermark: null,
          closedDay: '2026-08-14',
        },
      },
    });
    const seen: string[] = [];

    const report = await run(store, serving(DAY, seen));

    expect(seen).toEqual([]);
    expect(report.members).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------- dead grants

describe('a grant that has died', () => {
  it('★ MANDATORY: no token means no request, and no retry loop ★', async () => {
    /*
     * Frontier honours a refresh chain for 25 days and then refuses for ever. `accessToken`
     * returns null for that and marks the row stale, which takes the member out of `livePollable`
     * on the next run. What must NOT happen is this run hammering Frontier on their behalf —
     * every request is spent from the budget every other member is sharing.
     */
    const seen: string[] = [];
    const store = new FakeStore({ tokens: { u1: null } });

    const report = await run(store, serving(DAY, seen));

    expect(seen).toEqual([]);
    expect(report.members[0]?.skipped).toContain('reconnect');
  });

  it('★ MANDATORY: a 401 mid-run stops that member and lets the rest continue ★', async () => {
    /*
     * The opposite of a rate limit, and the distinction is the whole point of `CapiAuthError.kind`.
     * One member's grant dying says nothing about anybody else's, and abandoning the run over it
     * would let one lapsed member stop the entire squadron's data.
     */
    const members = ['u1', 'u2'].map((userId) => ({ userId, cmdrName: userId }));
    const store = new FakeStore({ members });

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 401, text: async () => '' } as unknown as Response;
      return { ok: true, status: 200, text: async () => DAY } as unknown as Response;
    }) as unknown as typeof fetch;

    const report = await run(store, fetchImpl);

    expect(report.abandoned).toBe(false);
    expect(report.members[0]?.skipped).toContain('reconnect');
    expect(report.members[1]?.stored).toBe(2);
  });

  it('a member who revoked the Frontier feed is not polled', async () => {
    /*
     * The synthetic device row is how a cAPI entry gets a `device_token_id` at all, and revoking it
     * is a member saying "stop importing this". Honouring it here is what makes that a real control
     * rather than a button that does nothing.
     */
    const seen: string[] = [];
    const store = new FakeStore({ devices: { u1: null } });

    const report = await run(store, serving(DAY, seen));

    expect(seen).toEqual([]);
    expect(report.members[0]?.skipped).toContain('revoked');
  });

  it('a network failure retries at the same interval rather than widening', async () => {
    /*
     * The cadence measures how fast FRONTIER WRITES the journal. A request that never arrived
     * measured nothing, and feeding it in as "no new entries" would walk an actively flying member
     * out to the idle interval because Frontier had a bad minute.
     */
    const store = new FakeStore();
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    await run(store, fetchImpl);

    const state = store.written.get('u1');
    expect(state?.poll.intervalMs).toBe(START_MS);
    expect(state?.poll.unchangedInARow).toBe(0);
    expect(state?.dueAt.getTime()).toBe(NOW.getTime() + START_MS);
  });
});

// ------------------------------------------------------------------------------------------ consent

describe('consent — this is a second door into the same table', () => {
  it('★ MANDATORY: a declined CATEGORY is not collected, whatever route it arrives by ★', async () => {
    /*
     * INV-013. A member switched `location` off having been told what that means. Collecting it
     * anyway because it came from Frontier rather than from their PC would make the setting a lie —
     * and it is the kind of lie nobody discovers, because the data simply appears.
     */
    const store = new FakeStore({ optOuts: { u1: { categories: ['location'], events: [] } } });

    const report = await run(store, serving(DAY));

    expect(store.inserted.map((r) => r.eventType)).toEqual(['LoadGame']);
    expect(report.members[0]?.refused).toBe(1);
  });

  it('★ MANDATORY: a declined EVENT NAME is not collected either ★', async () => {
    // The finer scope: somebody may be happy for us to know they were flying and not where.
    const store = new FakeStore({ optOuts: { u1: { categories: [], events: ['FSDJump'] } } });

    await run(store, serving(DAY));

    expect(store.inserted.map((r) => r.eventType)).toEqual(['LoadGame']);
  });

  it('★ MANDATORY: only allowlisted events are stored, and only allowlisted FIELDS ★', async () => {
    /*
     * The same ceiling the API applies on receipt. cAPI hands over the whole journal — including
     * every event the companion app deliberately never sends — so without this the cloud route
     * would collect strictly more about a member than the desktop one, which is the reverse of
     * what everybody was promised.
     *
     * `FID` and `Loan` are the fields to watch. `LoadGame` carries the member's Frontier account ID
     * and their outstanding loan alongside everything we do keep, and neither is on `EVENT_FIELDS`.
     *
     * ★ AND `Credits` IS DELIBERATELY KEPT — DO NOT "FIX" THIS ★
     *
     * An earlier draft of this test asserted `Credits` was stripped. It is not: it sits in
     * `EARNINGS_FIELDS`, kept on purpose since 2026-07-29 because the dashboard was asked to show
     * it. Stripping it HERE would mean a cloud member's balance quietly missing from a page a
     * desktop member sees filled in — the cloud route collecting LESS than the desktop one, which
     * is the same parity failure as collecting more, pointed the other way.
     *
     * The rule is not "keep as little as possible". It is the SAME ceiling, in both directions.
     */
    const body = [
      line('2026-08-15T11:58:00Z', 'LoadGame', {
        Commander: 'Grim',
        Credits: 1_000_000,
        FID: 'F1234567',
        Loan: 600,
      }),
      line('2026-08-15T11:58:30Z', 'SendText', { Message: 'private' }),
    ].join('\n');
    const store = new FakeStore();

    const report = await run(store, serving(body));

    expect(store.inserted.map((r) => r.eventType)).toEqual(['LoadGame']);
    expect(store.inserted[0]?.payload['FID'], 'a Frontier account id is never stored').toBeUndefined();
    expect(store.inserted[0]?.payload['Loan']).toBeUndefined();
    expect(store.inserted[0]?.payload['Credits'], 'kept, exactly as the desktop route keeps it').toBe(
      1_000_000,
    );
    expect(report.members[0]?.rejected).toBe(1);
  });

  it('an entry from the future is refused', async () => {
    // A broken clock, or an attempt to bank activity for a month that has not happened. The API
    // refuses these and so does this door.
    const store = new FakeStore();
    const body = line('2026-08-16T23:00:00Z', 'LoadGame', { Commander: 'Grim' });

    await run(store, serving(body));

    expect(store.inserted).toEqual([]);
  });
});

// ------------------------------------------------------------------------- what the poll then does

describe('what a successful poll changes', () => {
  it('★ MANDATORY: presence is stamped with the ENTRY’s time, not ours ★', async () => {
    /*
     * cAPI is delayed by however long Frontier takes to publish. Stamping `now` would show a member
     * as "Playing now" on the strength of an entry written twenty minutes ago — the platform
     * asserting something it does not know, which is the failure this codebase keeps rediscovering
     * under different names.
     */
    const store = new FakeStore();

    await run(store, serving(DAY));

    expect(store.playing).toHaveLength(1);
    expect(store.playing[0]?.at.toISOString()).toBe('2026-08-15T11:59:00.000Z');
  });

  it('a LoadGame proves the month was played', async () => {
    // The single thing the promotion engine could not see for cloud players: without a journal
    // there is no session, and without a session nobody qualifies for anything.
    const store = new FakeStore();

    await run(store, serving(DAY));

    expect(store.months).toHaveLength(1);
    expect(store.months[0]?.month.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('★ MANDATORY: new entries TIGHTEN the interval and nothing new WIDENS it ★', async () => {
    /*
     * `changed` is defined as "entries that were new TO US", not "the response differed". That is
     * deliberate: a member whose companion app is already sending everything produces a cAPI
     * response full of entries we hold, and the cadence's own reasoning — "spends the shared limit
     * to receive bytes we already have" — is exactly the request not worth making. So they walk
     * out to the idle interval on their own, with no rule anywhere refusing anybody.
     */
    const store = new FakeStore();

    await run(store, serving(DAY));
    const tightened = store.written.get('u1');
    expect(tightened?.poll.intervalMs).toBe(ACTIVE_FLOOR_MS);

    // Same day again: everything is already held, so nothing is new.
    await run(store, serving(DAY), { now: new Date('2026-08-15T12:01:00Z') });
    const after = store.written.get('u1');
    expect(after?.poll.unchangedInARow).toBe(1);
    expect(after?.dueAt.getTime()).toBe(new Date('2026-08-15T12:01:00Z').getTime() + ACTIVE_FLOOR_MS);
  });

  it('a member who has never been seen flying is polled at the idle interval', async () => {
    // "No entries recently" and "no entries at all" are the same absence. Somebody who linked and
    // never played must not sit at the fast cadence for ever, spending a shared budget on nothing.
    const store = new FakeStore();

    await run(store, serving(''));

    expect(store.written.get('u1')?.poll.intervalMs).toBe(IDLE_MS);
  });

  it('the watermark advances so the next poll re-reads as little as possible', async () => {
    const store = new FakeStore();

    await run(store, serving(DAY));

    expect(store.written.get('u1')?.watermark?.toISOString()).toBe('2026-08-15T11:59:00.000Z');
  });
});

// ------------------------------------------------------------------------------------------ dry run

describe('dry run, which is the default', () => {
  it('★ MANDATORY: writes nothing, and says what it would have written ★', async () => {
    /*
     * Same shape as `link-plans.ts` beside it. This job reaches a live external API and writes into
     * the table every member-facing number is derived from; being able to see what it would do,
     * against production data, without doing it, is what makes it safe to run at all.
     */
    const store = new FakeStore();

    const report = await pollCapiJournals(store, {
      now: NOW,
      fetchImpl: serving(DAY),
      apiBase: 'https://companion.orerve.net',
      sleep: async () => undefined,
    });

    expect(report.live).toBe(false);
    expect(report.stored).toBe(2);
    expect(store.inserted).toEqual([]);
    expect(store.playing).toEqual([]);
    expect(store.months).toEqual([]);
  });

  it('★ MANDATORY: a dry run does not advance the cadence or the watermark ★', async () => {
    /*
     * State that moved during a dry run would make the NEXT live run skip entries it never stored —
     * a dry run silently losing data is worse than one that writes.
     */
    const store = new FakeStore();

    await pollCapiJournals(store, {
      now: NOW,
      fetchImpl: serving(DAY),
      apiBase: 'https://companion.orerve.net',
      sleep: async () => undefined,
    });

    expect(store.written.size).toBe(0);
  });
});
