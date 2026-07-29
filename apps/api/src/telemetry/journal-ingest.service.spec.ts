import { describe, it, expect, beforeEach } from 'vitest';
import {
  JournalIngestService,
  monthKeyOf,
  MAX_EVENTS_PER_REQUEST,
  type IngestStore,
} from './journal-ingest.service.js';

/**
 * Receiving journal events (P1.11).
 *
 * ★ WHAT THIS UNBLOCKS ★
 *
 * Every activity row in production reads game_activity = 'unknown', so nobody
 * can satisfy the monthly qualification rule and the promotion engine would
 * report zero on 1 August whatever else were built. A LoadGame arriving here is
 * what turns that into 'observed'.
 */

const NOW = new Date('2026-07-27T12:00:00Z');

type Row = Parameters<IngestStore['insertIgnoringDuplicates']>[0][number];

class FakeStore implements IngestStore {
  inserted: Row[] = [];
  seenKeys = new Set<string>();
  observed: Array<{ userId: string; month: string }> = [];
  /*
   * ★ OPT-OUT NOW: EMPTY MEANS KEEP EVERYTHING (INV-013, amended 2026-07-29) ★
   *
   * This used to be a list of CONSENTED categories, and the default listed all
   * six optional ones — so the fake was permissive and the tests never
   * exercised a refusal by default. Under opt-out the default is genuinely
   * empty, which is both simpler and the real behaviour.
   */
  optOutCategories: string[] = [];
  optOutEvents: string[] = [];

  async telemetryOptOuts(): Promise<{ categories: readonly string[]; events: readonly string[] }> {
    return { categories: this.optOutCategories, events: this.optOutEvents };
  }

  playingAt: Date | null = null;

  async markPlaying(_userId: string, at: Date): Promise<void> {
    this.playingAt = at;
  }

  async insertIgnoringDuplicates(rows: readonly Row[]): Promise<number> {
    let n = 0;
    for (const r of rows) {
      if (this.seenKeys.has(r.eventKey)) continue;
      this.seenKeys.add(r.eventKey);
      this.inserted.push(r);
      n += 1;
    }
    return n;
  }
  async markGameActivityObserved(userId: string, month: Date): Promise<void> {
    this.observed.push({ userId, month: month.toISOString() });
  }
}

const ev = (over: Partial<{ name: string; occurredAt: string; data: Record<string, unknown> }> = {}) => ({
  name: 'LoadGame',
  occurredAt: '2026-07-27T11:00:00Z',
  data: { Commander: 'GRIM', Odyssey: true },
  ...over,
});

let store: FakeStore;
let svc: JournalIngestService;

beforeEach(() => {
  store = new FakeStore();
  svc = new JournalIngestService(store);
});

describe('the thing this exists for', () => {
  it('MANDATORY: a LoadGame marks the month as an OBSERVED session', async () => {
    // The single most important behaviour in P1.11. Without it, promotions
    // report zero forever.
    const r = await svc.ingest('u1', 'dev1', [ev()], NOW);

    expect(r.accepted).toBe(1);
    expect(store.observed).toEqual([{ userId: 'u1', month: '2026-07-01T00:00:00.000Z' }]);
  });

  it('marks the month the event HAPPENED in, not the month it arrived', async () => {
    // A first install replays months of journals. Attributing June's play to
    // July would hand somebody a qualifying month they did not earn — and
    // silently deny them the one they did.
    await svc.ingest('u1', 'dev1', [ev({ occurredAt: '2026-06-15T10:00:00Z' })], NOW);
    expect(store.observed[0]?.month).toBe('2026-06-01T00:00:00.000Z');
  });

  it('marks EVERY month in a batch that spans a boundary', async () => {
    await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ occurredAt: '2026-06-30T23:00:00Z' }),
        ev({ occurredAt: '2026-07-01T01:00:00Z' }),
      ],
      NOW,
    );
    expect(store.observed.map((o) => o.month).sort()).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ]);
  });

  it('does not mark a session for events that are not LoadGame', async () => {
    // Ranks and loadouts say what a commander IS, not that they played.
    await svc.ingest('u1', 'dev1', [ev({ name: 'Rank', data: { Combat: 7 } })], NOW);
    expect(store.observed).toEqual([]);
  });
});

describe('idempotency', () => {
  it('MANDATORY: re-sending the same batch accepts nothing new', async () => {
    // The uploader retries on any failure without advancing its offset, so
    // re-sends are the normal case rather than an edge one.
    const batch = [ev()];
    expect((await svc.ingest('u1', 'dev1', batch, NOW)).accepted).toBe(1);

    const second = await svc.ingest('u1', 'dev1', batch, NOW);
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it('MANDATORY: a duplicate LoadGame still confirms the session', async () => {
    /*
     * The month flag is set, not incremented, so marking it twice costs
     * nothing — and skipping it on a duplicate would mean a member whose only
     * send was a retry never gets credited for a month they genuinely played.
     */
    await svc.ingest('u1', 'dev1', [ev()], NOW);
    store.observed.length = 0;

    await svc.ingest('u1', 'dev1', [ev()], NOW);
    expect(store.observed).toHaveLength(1);
  });
});

describe('what is refused', () => {
  it('MANDATORY: an event outside the allowlist is rejected', async () => {
    // The app filters before sending. This is the ceiling on what a BUGGY
    // future version of our own app could store, not a defence against a
    // hostile one — a modified client can send anything.
    const r = await svc.ingest('u1', 'dev1', [ev({ name: 'SendText', data: { Message: 'hi' } })], NOW);

    expect(r.accepted).toBe(0);
    expect(r.rejected).toBe(1);
    expect(store.inserted).toEqual([]);
  });

  it('MANDATORY: strips a disallowed FIELD even from an allowed event', async () => {
    /*
     * ★ Credits MOVED TO THE ALLOWED SIDE ON 2026-07-29 ★
     *
     * The balance is collected now, on the squadron owner's instruction, and
     * rides with the `profile` category — which a member can switch off.
     * Deliberately not with `session`, which they cannot: the one required
     * category must never be the reason somebody has no way to refuse
     * something.
     *
     * `FID` did NOT move and never will. A Frontier account id identifies the
     * member to Frontier and answers no question the squadron has — which is
     * what this test is really guarding, now that the balance is not.
     */
    const r = await svc.ingest(
      'u1',
      'dev1',
      [ev({ data: { Commander: 'GRIM', Credits: 999_999_999, FID: 'F123', Loan: 5 } })],
      NOW,
    );

    expect(r.accepted).toBe(1);
    expect(JSON.stringify(store.inserted[0]?.payload)).toContain('999999999');
    expect(JSON.stringify(store.inserted[0]?.payload)).not.toContain('F123');
    expect(JSON.stringify(store.inserted[0]?.payload)).not.toContain('"Loan"');
  });

  it('MANDATORY: refuses an event from the FUTURE', async () => {
    /*
     * Replaying OLD journals is normal — a first install has months of them.
     * A future timestamp is a broken clock or an attempt to bank activity for
     * a month that has not happened, and it would create a qualifying month
     * out of nothing.
     */
    const r = await svc.ingest('u1', 'dev1', [ev({ occurredAt: '2027-01-01T00:00:00Z' })], NOW);

    expect(r.rejected).toBe(1);
    expect(store.observed).toEqual([]);
  });

  it('allows a small clock skew, because real clocks drift', async () => {
    const slightlyAhead = new Date(NOW.getTime() + 60_000).toISOString();
    expect((await svc.ingest('u1', 'dev1', [ev({ occurredAt: slightlyAhead })], NOW)).accepted).toBe(1);
  });

  it('rejects an unparseable timestamp', async () => {
    expect((await svc.ingest('u1', 'dev1', [ev({ occurredAt: 'not a date' })], NOW)).rejected).toBe(1);
  });

  it('MANDATORY: caps how much one request may carry', async () => {
    // Otherwise a single request could carry a member's entire journal history
    // and hold a connection open while it is written.
    const many = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, (_, i) =>
      ev({ occurredAt: new Date(NOW.getTime() - i * 1000).toISOString() }),
    );
    await expect(svc.ingest('u1', 'dev1', many, NOW)).rejects.toThrow(/too many/i);
  });

  it('accepts the good events in a mixed batch', async () => {
    // One bad event must not cost the member the rest of the batch.
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev(),
        // ReceiveText is chat. It is not on the allowlist and never will be.
        ev({ name: 'ReceiveText' }),
        ev({ name: 'Rank', data: { Combat: 7 } }),
      ],
      NOW,
    );

    expect(r.accepted).toBe(2);
    expect(r.rejected).toBe(1);
  });
});

describe('monthKeyOf', () => {
  it('pins to the first of the month in UTC', () => {
    expect(monthKeyOf(new Date('2026-07-27T23:59:59Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });

  it('MANDATORY: does not shift a month because of local time', () => {
    // 1 July at 00:30 UTC is still July. Reading it in a negative-offset zone
    // would file it under June and give somebody the wrong qualifying month.
    expect(monthKeyOf(new Date('2026-07-01T00:30:00Z')).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
  });
});

describe('consent (INV-013)', () => {
  it('MANDATORY: the BASELINE is stored with no consent recorded at all', async () => {
    /*
     * ★ THE AMENDMENT THIS ENCODES ★
     *
     * Session, profile and fleet come with running the app. They are what the
     * platform exists to hold, and making them conditional on a checkbox meant
     * a member could install the app, leave it running for a month, and be told
     * they had not qualified for a promotion because of a box they never saw.
     *
     * The consent is the INSTALL — an app that is entirely optional, ships
     * switched off, and shows them a real batch from their own journals first.
     */
    store.optOutCategories = [];
    const r = await svc.ingest(
      'u1',
      'dev1',
      [ev(), ev({ name: 'Rank', data: { Combat: 7 } }), ev({ name: 'StoredShips', data: {} })],
      NOW,
    );

    expect(r.accepted).toBe(3);
    expect(r.refused).toEqual({});
    expect(store.observed).toHaveLength(1);
  });

  it('MANDATORY: everything is kept when nothing is declined', async () => {
    /*
     * ★ THE INVERSION (INV-013, amended 2026-07-29) ★
     *
     * This test previously asserted the OPPOSITE: that an optional category was
     * refused without consent. Telemetry is opt-out now — the app sends what it
     * reads and the website is where a member declines — so a member who has
     * never opened their settings has everything kept.
     *
     * The consequence is stated in the invariant and worth repeating here: a
     * declined event now leaves the member's machine and is discarded by the
     * server, where it used to never travel.
     */
    store.optOutCategories = [];
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ name: 'FSDJump', data: { StarSystem: 'Sol' } }),
        ev({ name: 'Bounty', data: { TotalReward: 50_000 } }),
      ],
      NOW,
    );

    expect(r.accepted).toBe(2);
    expect(r.refused).toEqual({});
  });

  it('MANDATORY: a declined CATEGORY is discarded', async () => {
    store.optOutCategories = ['location'];
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ name: 'FSDJump', data: { StarSystem: 'Sol' } }),
        ev({ name: 'Bounty', data: { TotalReward: 50_000 } }),
      ],
      NOW,
    );

    expect(r.accepted).toBe(1);
    expect(r.refused).toEqual({ location: 1 });
  });

  it('MANDATORY: a declined EVENT is discarded while its category survives', async () => {
    /*
     * The finer scope, and the reason it exists: somebody may be happy for us
     * to know they were in a conflict zone and not what bounties they claimed.
     * A category-only model would force them to give up both or neither.
     */
    store.optOutEvents = ['Bounty'];
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ name: 'Bounty', data: { TotalReward: 50_000 } }),
        ev({ name: 'PVPKill', data: { CombatRank: 3 } }),
      ],
      NOW,
    );

    expect(r.accepted).toBe(1);
    expect(r.refused).toEqual({ Bounty: 1 });
    expect(store.inserted.map((r2) => r2.eventType)).toEqual(['PVPKill']);
  });

  it('MANDATORY: says WHICH categories were refused, rather than dropping them silently', async () => {
    /*
     * The invariant is explicit that a non-consented event gets a clear answer.
     * Folding it into a rejection count would leave the app appearing to work
     * while uploading into a void, and the member with no way to discover it.
     */
    store.optOutCategories = ['location'];
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ name: 'MarketSell', data: { Type: 'gold', TotalSale: 1_000 } }),
        ev({ name: 'FSDJump', data: { StarSystem: 'Sol' } }),
      ],
      NOW,
    );

    expect(r.accepted).toBe(1);
    expect(r.refused).toEqual({ location: 1 });
  });

  it('declining one category does not close the others', async () => {
    store.optOutCategories = ['trade'];
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ name: 'Bounty', data: { TotalReward: 50_000 } }),
        ev({ name: 'MarketSell', data: { Type: 'gold', TotalSale: 1_000 } }),
      ],
      NOW,
    );

    expect(r.accepted).toBe(1);
    expect(r.refused).toEqual({ trade: 1 });
  });

  it('files each event under the right category', async () => {
    store.optOutCategories = [];
    await svc.ingest(
      'u1',
      'dev1',
      [
        ev(),
        ev({ name: 'Rank', data: { Combat: 7 } }),
        ev({ name: 'SquadronStartup', data: { SquadronName: "Grim's Squad" } }),
        ev({ name: 'StoredShips', data: { StarSystem: 'Sol' } }),
        ev({ name: 'FSDJump', data: { StarSystem: 'Sol' } }),
        ev({ name: 'Bounty', data: { TotalReward: 1 } }),
      ],
      NOW,
    );

    expect(store.inserted.map((r) => [r.eventType, r.category])).toEqual([
      ['LoadGame', 'session'],
      ['Rank', 'profile'],
      ['SquadronStartup', 'profile'],
      ['StoredShips', 'fleet'],
      ['FSDJump', 'location'],
      ['Bounty', 'combat'],
    ]);
  });
});

describe('the event key is ours, not the caller\'s', () => {
  it('MANDATORY: a caller cannot choose the key its events are stored under', async () => {
    /*
     * The unique index over event_key is GLOBAL rather than per-member. A client
     * that picked its own keys could claim keys another member's events would
     * later need, and the victim's genuine events would vanish as "duplicates"
     * with nothing anywhere recording that they had arrived.
     *
     * Deriving the key from the device token makes that impossible: it is
     * namespaced by a credential the caller cannot choose.
     */
    await svc.ingest(
      'u1',
      'dev1',
      [{ ...ev(), eventKey: 'attacker-chosen' } as never],
      NOW,
    );

    expect(store.inserted[0]?.eventKey).not.toBe('attacker-chosen');
    expect(store.inserted[0]?.eventKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('MANDATORY: the same event from two DIFFERENT devices does not collide', async () => {
    /*
     * A member may run the app on a desktop and a laptop reading the same
     * journal. If the key ignored the device, the second install's events would
     * be swallowed as duplicates of the first's — which is the behaviour we
     * want for a RETRY and emphatically not for a second machine.
     */
    await svc.ingest('u1', 'dev1', [ev()], NOW);
    await svc.ingest('u1', 'dev2', [ev()], NOW);

    expect(store.inserted).toHaveLength(2);
  });

  it('MANDATORY: events sharing a whole-second timestamp are kept apart', async () => {
    /*
     * Elite's journal timestamps have WHOLE-SECOND resolution, so a burst of
     * events shares one. Without the payload in the hash they would collapse
     * into one row — under-counting exactly the activity we exist to measure,
     * with no anomaly visible in any metric (DATA-INTEGRITY B1).
     */
    const at = '2026-07-27T11:00:00Z';
    await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ name: 'Rank', occurredAt: at, data: { Combat: 7 } }),
        ev({ name: 'Rank', occurredAt: at, data: { Combat: 8 } }),
      ],
      NOW,
    );

    expect(store.inserted).toHaveLength(2);
  });

  it('MANDATORY: key order in the payload does not change the key', async () => {
    // JSON.stringify preserves insertion order, so without canonicalisation the
    // same event parsed twice could hash differently and a retry would be
    // stored again as though it were new.
    await svc.ingest('u1', 'dev1', [ev({ data: { Commander: 'GRIM', Odyssey: true } })], NOW);
    const first = store.inserted[0]?.eventKey;

    store.inserted.length = 0;
    store.seenKeys.clear();
    await svc.ingest('u1', 'dev1', [ev({ data: { Odyssey: true, Commander: 'GRIM' } })], NOW);

    expect(store.inserted[0]?.eventKey).toBe(first);
  });
});
