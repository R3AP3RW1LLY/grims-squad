import { describe, it, expect } from 'vitest';
import {
  resolveStations,
  MAX_ATTEMPTS,
  type PendingRow,
  type ResolvedStation,
  type StationSource,
  type StationStore,
} from './resolve-stations.js';

/**
 * Turning EDDN sightings into stations we hold.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "add the stations we do not hold" — and, asked what one should become given EDDN carries only a
 * name, a system and a market id: "Look each one up before creating it", so it lands complete with
 * pad size and type rather than as a stub.
 *
 * A stub answers "where can I sell Painite" and then lies to the next question, "can my Cutter dock
 * there". So the rule this suite protects is: nothing is written until it is complete.
 */

const STATION = (over: Partial<ResolvedStation> = {}): ResolvedStation => ({
  marketId: 3_700_001,
  name: 'Cornwallis Terminal',
  type: 'Coriolis Starport',
  largePads: 4,
  distanceToArrival: 240,
  ...over,
});

const ROW = (over: Partial<PendingRow> = {}): PendingRow => ({
  marketId: 3_700_001n,
  stationName: 'Cornwallis Terminal',
  systemName: 'Sonfu',
  attempts: 0,
  ...over,
});

function harness(opts: {
  pending: PendingRow[];
  systems?: Record<string, string | null>;
  upstream?: Record<string, readonly ResolvedStation[] | null>;
}) {
  const written: Array<{ id64: string; name: string; type: string | null }> = [];
  const resolved: bigint[] = [];
  const tried: Array<{ marketId: bigint; error: string | null }> = [];
  const abandoned: Array<{ marketId: bigint; reason: string }> = [];
  let calls = 0;

  const store: StationStore = {
    pending: async () => opts.pending,
    systemId64: async (name) => {
      const id = (opts.systems ?? { Sonfu: '900001' })[name];
      return id == null ? null : { id64: id, name };
    },
    writeStation: async ({ id64, station }) => {
      written.push({ id64, name: station.name, type: station.type });
    },
    markResolved: async (m) => {
      resolved.push(m);
    },
    markTried: async (m, error) => {
      tried.push({ marketId: m, error });
    },
    abandon: async (m, reason) => {
      abandoned.push({ marketId: m, reason });
    },
  };

  const source: StationSource = {
    stationsIn: async (name) => {
      calls += 1;
      return (opts.upstream ?? { Sonfu: [STATION()] })[name] ?? null;
    },
  };

  return { store, source, written, resolved, tried, abandoned, calls: () => calls };
}

describe('resolving a sighting', () => {
  it('writes a COMPLETE station and marks it resolved', async () => {
    const h = harness({ pending: [ROW()] });

    const report = await resolveStations(h.store, h.source);

    expect(h.written).toEqual([
      { id64: '900001', name: 'Cornwallis Terminal', type: 'Coriolis Starport' },
    ]);
    expect(h.resolved).toEqual([3_700_001n]);
    expect(report.resolved).toBe(1);
  });

  it('MANDATORY: writes nothing when upstream has never heard of it', async () => {
    /*
     * The no-stubs rule. A station built from the sighting alone would have a name and no pad size,
     * which answers one question and lies about the next.
     */
    const h = harness({ pending: [ROW()], upstream: { Sonfu: [] } });

    const report = await resolveStations(h.store, h.source);

    expect(h.written).toEqual([]);
    expect(h.resolved).toEqual([]);
    expect(report.stillUnknown).toBe(1);
  });

  it('MANDATORY: asks upstream ONCE per system, not once per station', async () => {
    /*
     * The reason the job is affordable. Unknown stations cluster — a system nobody has indexed
     * contributes all of its stations at once — and every source answers per system anyway. Eleven
     * lookups become one, which is the difference between keeping up and not.
     */
    const h = harness({
      pending: [
        ROW({ marketId: 1n, stationName: 'A' }),
        ROW({ marketId: 2n, stationName: 'B' }),
        ROW({ marketId: 3n, stationName: 'C' }),
      ],
      upstream: {
        Sonfu: [
          STATION({ marketId: 1, name: 'A' }),
          STATION({ marketId: 2, name: 'B' }),
          STATION({ marketId: 3, name: 'C' }),
        ],
      },
    });

    await resolveStations(h.store, h.source);

    expect(h.calls()).toBe(1);
    expect(h.written).toHaveLength(3);
  });

  it('matches on market id before name', async () => {
    /*
     * The id is the identity; the name is what a carrier owner changes on a whim. Matching on name
     * alone would eventually attach one carrier's market to another's record.
     */
    const h = harness({
      pending: [ROW({ marketId: 3_700_001n, stationName: 'Renamed Since' })],
      upstream: { Sonfu: [STATION({ marketId: 3_700_001, name: 'Actual Name' })] },
    });

    await resolveStations(h.store, h.source);

    expect(h.written[0]?.name).toBe('Actual Name');
  });

  it('falls back to the name when the market id is not indexed yet', async () => {
    // Common for a station built this week: upstream lists it but has not recorded its market id.
    const h = harness({
      pending: [ROW({ marketId: 999n, stationName: 'Cornwallis Terminal' })],
      upstream: { Sonfu: [STATION({ marketId: 0 })] },
    });

    await resolveStations(h.store, h.source);

    expect(h.written).toHaveLength(1);
  });

  it('MANDATORY: writes nothing when we do not hold the system', async () => {
    /*
     * A station's key is `<system id64>/<name>` and its coordinates ARE its system's. Inventing an
     * id64 would produce a station no spatial query could ever find — worse than not having it.
     */
    const h = harness({ pending: [ROW({ systemName: 'Nowhere' })], systems: { Nowhere: null } });

    const report = await resolveStations(h.store, h.source);

    expect(h.written).toEqual([]);
    expect(report.unknownSystems).toBe(1);
  });

  it('gives up after enough tries, rather than retrying for ever', async () => {
    // A construction site laid down this morning is real and unknown everywhere. Patience, then a
    // stop — retrying every run for ever costs a request and learns nothing.
    const h = harness({
      pending: [ROW({ attempts: MAX_ATTEMPTS - 1 })],
      upstream: { Sonfu: [] },
    });

    const report = await resolveStations(h.store, h.source);

    expect(report.abandoned).toBe(1);
    expect(h.abandoned[0]?.marketId).toBe(3_700_001n);
  });

  it('does not count an unreachable source against the station', async () => {
    /*
     * Rate limited or down is not the station's fault. Counting it would burn a station's five
     * attempts on an outage and abandon something real.
     */
    const h = harness({ pending: [ROW({ attempts: MAX_ATTEMPTS - 1 })], upstream: { Sonfu: null } });

    const report = await resolveStations(h.store, h.source);

    expect(report.abandoned).toBe(0);
    expect(report.stillUnknown).toBe(1);
    expect(h.tried[0]?.error).toMatch(/did not answer/i);
  });
});
