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

const ev = (over: Partial<{ name: string; occurredAt: string; data: Record<string, unknown>; eventKey: string }> = {}) => ({
  name: 'LoadGame',
  occurredAt: '2026-07-27T11:00:00Z',
  data: { Commander: 'GRIM', Odyssey: true },
  eventKey: 'k'.repeat(64),
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
        ev({ occurredAt: '2026-06-30T23:00:00Z', eventKey: 'a'.repeat(64) }),
        ev({ occurredAt: '2026-07-01T01:00:00Z', eventKey: 'b'.repeat(64) }),
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
    const r = await svc.ingest(
      'u1',
      'dev1',
      [ev({ data: { Commander: 'GRIM', Credits: 999_999_999, FID: 'F123' } })],
      NOW,
    );

    expect(r.accepted).toBe(1);
    expect(JSON.stringify(store.inserted[0]?.payload)).not.toContain('999999999');
    expect(JSON.stringify(store.inserted[0]?.payload)).not.toContain('F123');
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

  it('rejects a missing or too-short event key', async () => {
    // The key is what makes a retry safe. Without a real one we cannot dedupe,
    // and accepting it would let a crash-loop inflate somebody's activity.
    for (const key of ['', 'short', 'x'.repeat(31)]) {
      const r = await svc.ingest('u1', 'dev1', [ev({ eventKey: key })], NOW);
      expect(r.rejected, key).toBe(1);
    }
  });

  it('rejects an unparseable timestamp', async () => {
    expect((await svc.ingest('u1', 'dev1', [ev({ occurredAt: 'not a date' })], NOW)).rejected).toBe(1);
  });

  it('MANDATORY: caps how much one request may carry', async () => {
    // Otherwise a single request could carry a member's entire journal history
    // and hold a connection open while it is written.
    const many = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, (_, i) =>
      ev({ eventKey: String(i).padStart(64, '0') }),
    );
    await expect(svc.ingest('u1', 'dev1', many, NOW)).rejects.toThrow(/too many/i);
  });

  it('accepts the good events in a mixed batch', async () => {
    // One bad event must not cost the member the rest of the batch.
    const r = await svc.ingest(
      'u1',
      'dev1',
      [
        ev({ eventKey: 'a'.repeat(64) }),
        ev({ name: 'Bounty', eventKey: 'b'.repeat(64) }),
        ev({ name: 'Rank', data: { Combat: 7 }, eventKey: 'c'.repeat(64) }),
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
