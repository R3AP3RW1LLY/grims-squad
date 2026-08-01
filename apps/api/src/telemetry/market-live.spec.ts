import { describe, it, expect, beforeEach } from 'vitest';
import { JournalIngestService, type IngestStore, type MarketUpdater } from './journal-ingest.service.js';

/**
 * Live market updates from members' journals.
 *
 * ★ WHAT THESE TESTS ARE ACTUALLY FOR ★
 *
 * Every failure this guards against is SILENT. A market update that never fires
 * looks exactly like a station nobody has visited; a delta applied twice looks
 * exactly like a station somebody else drained. Neither raises an error, neither
 * shows up in a log, and both produce a table that is confidently wrong — which
 * is worse than the stale figures they replace, because a member acts on them.
 */

type Row = Parameters<IngestStore['insertIgnoringDuplicates']>[0][number];

class FakeStore implements IngestStore {
  // Members default to showing their fleet; these tests are about markets, not builds.
  async showsFleet(): Promise<boolean> {
    return true;
  }

  readonly seen = new Set<string>();
  readonly rows: Row[] = [];

  async insertIgnoringDuplicates(rows: readonly Row[]): Promise<readonly string[]> {
    const keys: string[] = [];
    for (const r of rows) {
      if (this.seen.has(r.eventKey)) continue;
      this.seen.add(r.eventKey);
      this.rows.push(r);
      keys.push(r.eventKey);
    }
    return keys;
  }
  async markGameActivityObserved(): Promise<void> {}
  async telemetryOptOuts(): Promise<{ categories: readonly string[]; events: readonly string[] }> {
    return { categories: [], events: [] };
  }
  async markPlaying(): Promise<void> {}
  async markStopped(): Promise<void> {}
  async contribution(): Promise<{ storedEvents: number; firstEventAt: Date | null }> {
    return { storedEvents: this.rows.length, firstEventAt: null };
  }
}

class FakeMarket implements MarketUpdater {
  readonly applied: Array<Record<string, unknown> & { event: string }> = [];
  async apply(event: Record<string, unknown> & { event: string }): Promise<number> {
    this.applied.push(event);
    return 1;
  }
}

/** A member declining a category, so the gate can be tested. */
class OptedOutStore extends FakeStore {
  override async telemetryOptOuts(): Promise<{ categories: readonly string[]; events: readonly string[] }> {
    return { categories: ['trade'], events: [] };
  }
}

const NOW = new Date('2026-08-01T12:00:00Z');

const buy = (count: number, at = '2026-08-01T11:00:00Z') => ({
  name: 'MarketBuy',
  occurredAt: at,
  data: { MarketID: 3223343616, Type: 'platinum', Type_Localised: 'Platinum', Count: count, TotalCost: 500_000 },
});

let store: FakeStore;
let market: FakeMarket;
let svc: JournalIngestService;

beforeEach(() => {
  store = new FakeStore();
  market = new FakeMarket();
  svc = new JournalIngestService(store, market);
});

describe('a trade moves the station it happened at', () => {
  it('applies a buy', async () => {
    await svc.ingest('u1', 'dev1', [buy(794)], NOW);

    expect(market.applied).toHaveLength(1);
    expect(market.applied[0]).toMatchObject({ event: 'MarketBuy', MarketID: 3223343616, Count: 794 });
  });

  it('carries the full item list on a snapshot, which storage deliberately drops', async () => {
    /*
     * The stored payload keeps only which station was opened — see EVENT_FIELDS.
     * The updater must still receive the RAW event, because the item list IS the
     * update. If this ever reads the filtered payload instead, snapshots become
     * no-ops and nothing anywhere says so.
     */
    await svc.ingest(
      'u1',
      'dev1',
      [
        {
          name: 'Market',
          occurredAt: '2026-08-01T11:00:00Z',
          data: {
            MarketID: 3223343616,
            StationName: 'Jameson Memorial',
            StarSystem: 'Shinrarta Dezhra',
            Items: [{ Name_Localised: 'Platinum', BuyPrice: 0, SellPrice: 58_000, Stock: 0, Demand: 12_000 }],
          },
        },
      ],
      NOW,
    );

    expect(market.applied[0]?.['Items']).toHaveLength(1);
    // ...and the member's own row kept none of it.
    expect(store.rows[0]?.payload['Items']).toBeUndefined();
    expect(store.rows[0]?.payload['StationName']).toBe('Jameson Memorial');
  });
});

describe('a resent batch must not move the station twice', () => {
  it('ignores a duplicate buy', async () => {
    /*
     * ★ THE FAILURE THIS EXISTS FOR ★
     *
     * The companion retries a failed upload, so the same MarketBuy genuinely
     * arrives twice. Subtracting 794 tonnes twice reports a station as empty
     * that has stock — and routes the next member somewhere else for nothing.
     */
    await svc.ingest('u1', 'dev1', [buy(794)], NOW);
    await svc.ingest('u1', 'dev1', [buy(794)], NOW);

    expect(store.rows).toHaveLength(1);
    expect(market.applied).toHaveLength(1);
  });

  it('still applies two genuinely separate buys of the same size', async () => {
    // Same commodity, same count, different second — two real trades, not a
    // retry. Both must count, or a hauling run of identical loads under-reports.
    await svc.ingest('u1', 'dev1', [buy(100, '2026-08-01T11:00:00Z')], NOW);
    await svc.ingest('u1', 'dev1', [buy(100, '2026-08-01T11:00:05Z')], NOW);

    expect(market.applied).toHaveLength(2);
  });
});

describe('the opt-out is real', () => {
  it('does not use the trades of a member who declined trade telemetry', async () => {
    /*
     * The result would be anonymous — a station price, nothing about them. Using
     * it anyway because of that would make the setting a lie, and the setting is
     * the whole of INV-013. Their stations are still covered by the nightly dump.
     */
    const svc2 = new JournalIngestService(new OptedOutStore(), market);
    const result = await svc2.ingest('u1', 'dev1', [buy(794)], NOW);

    expect(market.applied).toHaveLength(0);
    expect(result.refused['trade']).toBe(1);
  });
});

describe('a market failure never costs the member their upload', () => {
  it('stores the events even when the updater throws', async () => {
    const broken: MarketUpdater = {
      async apply() {
        throw new Error('knowledge store unreachable');
      },
    };
    const svc2 = new JournalIngestService(store, broken);

    const result = await svc2.ingest('u1', 'dev1', [buy(794)], NOW);

    expect(result.accepted).toBe(1);
    expect(store.rows).toHaveLength(1);
  });
});
