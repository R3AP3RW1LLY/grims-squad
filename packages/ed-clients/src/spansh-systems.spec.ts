import { describe, expect, it, vi } from 'vitest';
import { claimableOnly, systemsNear, type SpanshSystem } from './spansh-systems.js';

/**
 * Reading the galaxy's uninhabited half.
 *
 * ★ TWO FIELDS THAT LIE IF READ NAIVELY ★
 *
 * `is_colonised` is written only when true — never `false` — so `=== false` matches nothing and
 * reports every system in the bubble as claimable... or none of them, depending which way round the
 * test is written. Reading it wrong once produced "0 claimable out of 3,208".
 *
 * And the population FILTER is silently ignored by the API, so filtering has to happen here, on
 * fields that are actually present in the rows.
 */

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Test System',
  x: 1,
  y: 2,
  z: 3,
  distance: 4.5,
  population: 0,
  body_count: 12,
  allegiance: null,
  ...over,
});

function fakeFetch(pages: Array<Record<string, unknown>[]>): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    const results = pages[call] ?? [];
    call += 1;
    return { ok: true, json: async () => ({ results }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('reading systems near a point', () => {
  it('maps a row into the shape the scout uses', async () => {
    const out = await systemsNear('Sol', 15, { fetchImpl: fakeFetch([[row()]]) });

    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('Test System');
    expect(out[0]?.bodyCount).toBe(12);
    expect(out[0]?.distance).toBe(4.5);
  });

  it('MANDATORY: treats an ABSENT is_colonised as not colonised', () => {
    /*
     * The field is only ever `true`. A system with no such key is uninhabited and claimable, and
     * reading it as anything else empties the candidate list without explanation.
     */
    const systems: SpanshSystem[] = [
      { name: 'empty', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: false, stationCount: 0 },
      { name: 'taken', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: true, needsPermit: false, stationCount: 0 },
    ];

    expect(claimableOnly(systems).map((s) => s.name)).toEqual(['empty']);
  });

  it('excludes inhabited and permit-locked systems from the claimable set', () => {
    const systems: SpanshSystem[] = [
      { name: 'peopled', x: 0, y: 0, z: 0, distance: 1, population: 5_000, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: false, stationCount: 1 },
      { name: 'locked', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: true, stationCount: 0 },
      { name: 'free', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: false, stationCount: 0 },
    ];

    expect(claimableOnly(systems).map((s) => s.name)).toEqual(['free']);
  });

  it('pages until a short page arrives', async () => {
    const full = Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` }));
    const out = await systemsNear('Sol', 15, { fetchImpl: fakeFetch([full, [row({ name: 'last' })]]) });

    expect(out).toHaveLength(51);
    expect(out.at(-1)?.name).toBe('last');
  });

  it('stops at the page cap rather than sweeping for ever', async () => {
    const full = Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` }));
    const out = await systemsNear('Sol', 15, {
      fetchImpl: fakeFetch([full, full, full, full]),
      maxPages: 2,
    });

    expect(out).toHaveLength(100);
  });

  it('returns what it has when the service fails mid-sweep, rather than throwing', async () => {
    /*
     * A partial answer beats none: the scout ranks what arrived and the page reports how many
     * systems were considered, so a truncated sweep is visible instead of silent.
     */
    let call = 0;
    const flaky = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({ results: Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` })) }),
        } as unknown as Response;
      }
      throw new Error('network went away');
    }) as unknown as typeof fetch;

    const out = await systemsNear('Sol', 15, { fetchImpl: flaky });
    expect(out).toHaveLength(50);
  });

  it('drops a row with no usable name instead of inventing one', async () => {
    const out = await systemsNear('Sol', 15, { fetchImpl: fakeFetch([[row(), row({ name: 42 })]]) });
    expect(out).toHaveLength(1);
  });

  it('counts stations from the array the API returns', async () => {
    const out = await systemsNear('Sol', 15, {
      fetchImpl: fakeFetch([[row({ population: 900, stations: [{}, {}, {}] })]]),
    });
    expect(out[0]?.stationCount).toBe(3);
  });
});
