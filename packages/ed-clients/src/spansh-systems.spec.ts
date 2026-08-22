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

    expect(out.systems).toHaveLength(1);
    expect(out.systems[0]?.name).toBe('Test System');
    expect(out.systems[0]?.bodyCount).toBe(12);
    expect(out.systems[0]?.distance).toBe(4.5);
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

  it('★ MANDATORY: a system with anything docked in it is NOT claimable ★', () => {
    /*
     * ★ REPORTED FROM PRODUCTION — SQUADRON OWNER, 2026-08-12 ★
     *
     * "when were using the scout module, and looking for unclaimed systems its showing us systems
     * that are claimed, we need this fixed ASAP! this is only supposed to find unclaimed systems!"
     *
     * The filter tested population, the permit and `is_colonised`, and passed anything that cleared
     * all three. A system claimed an hour ago clears all three: population is still 0, no permit is
     * needed, and Spansh's `is_colonised` lags — the field is only ever written `true`, so ABSENT
     * reads as unclaimed, which is the safe direction for an uninhabited system and the wrong one
     * for a fresh claim.
     *
     * What a fresh claim always has is a SYSTEM COLONISATION SHIP docked in it. An genuinely
     * unclaimed system has nothing docked in it at all — no station, no ship, nothing — so a
     * station count above zero is the observable proof somebody got there first.
     *
     * Spansh exposes no architect field (checked against the live API on 2026-08-12: it returns
     * is_colonised, population, stations and no ownership of any kind), so this IS the architect
     * signal rather than a substitute for it.
     */
    const systems: SpanshSystem[] = [
      { name: 'just claimed', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: false, stationCount: 1 },
      { name: 'virgin', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: false, stationCount: 0 },
    ];

    expect(claimableOnly(systems).map((s) => s.name)).toEqual(['virgin']);
  });

  it('★ MANDATORY: it still refuses the obvious cases ★', () => {
    // The three original rules are unchanged; the station count is an addition, not a replacement.
    const systems: SpanshSystem[] = [
      { name: 'colonised', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: true, needsPermit: false, stationCount: 0 },
      { name: 'permit', x: 0, y: 0, z: 0, distance: 1, population: 0, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: true, stationCount: 0 },
      { name: 'peopled', x: 0, y: 0, z: 0, distance: 1, population: 1, bodyCount: 5, allegiance: null, primaryEconomy: null, isColonised: false, needsPermit: false, stationCount: 0 },
    ];

    expect(claimableOnly(systems)).toEqual([]);
  });

  it('pages until a short page arrives', async () => {
    const full = Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` }));
    const out = await systemsNear('Sol', 15, { fetchImpl: fakeFetch([full, [row({ name: 'last' })]]) });

    expect(out.systems).toHaveLength(51);
    expect(out.systems.at(-1)?.name).toBe('last');
  });

  it('stops at the page cap rather than sweeping for ever', async () => {
    const full = Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` }));
    const out = await systemsNear('Sol', 15, {
      fetchImpl: fakeFetch([full, full, full, full]),
      maxPages: 2,
    });

    expect(out.systems).toHaveLength(100);
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
    expect(out.systems).toHaveLength(50);
  });

  it('drops a row with no usable name instead of inventing one', async () => {
    const out = await systemsNear('Sol', 15, { fetchImpl: fakeFetch([[row(), row({ name: 42 })]]) });
    expect(out.systems).toHaveLength(1);
  });

  it('counts stations from the array the API returns', async () => {
    const out = await systemsNear('Sol', 15, {
      fetchImpl: fakeFetch([[row({ population: 900, stations: [{}, {}, {}] })]]),
    });
    expect(out.systems[0]?.stationCount).toBe(3);
  });
});

/**
 * ★ THE BUG THE OWNER REPORTED, 2026-08-22 ★
 *
 * "the scouting system in the colonization module is now no longer finding anything or returning any
 * results!"
 *
 * Nothing was broken. The sweep was TIMING OUT and saying nothing about it: every failure path in
 * this module was `break`, so a stalled first page returned an empty array, and the scout rendered
 * that as "Nothing claimable in range" — a sentence that means the galaxy is empty out there.
 *
 * Reproduced against production, the same search minutes apart:
 *
 *     range 15 →  1.6s → 12 candidates
 *     range 25 → 20.8s →  0 candidates   ← the 20-second abort, reported as "nothing"
 *     range 25 →  2.4s → 48 candidates   ← same query, moments later
 *
 * A member cannot act on that. "There is nothing there" sends them somewhere else; "we failed to
 * ask" means search again. The two must never render the same.
 *
 * ★ SO INCOMPLETENESS IS PART OF THE ANSWER, NOT A LOG LINE ★
 *
 * `systemsNear` returns what it found AND whether it found all of it. The type carries it so a
 * caller cannot accidentally drop it — the previous signature returned a bare array, which is
 * exactly how the truncation stayed invisible for as long as it did.
 */
describe('a sweep says whether it finished', () => {
  it('★ MANDATORY: a truncated sweep is not an empty one ★', async () => {
    /*
     * The heart of it. Page 0 stalls, every retry stalls, and NOTHING comes back — which is
     * byte-for-byte what a genuinely empty region returns. The only thing telling them apart is
     * `complete`, so this is the assertion that must never be deleted.
     */
    const dead = vi.fn(async () => {
      throw new Error('network went away');
    }) as unknown as typeof fetch;

    const out = await systemsNear('Sol', 15, { fetchImpl: dead });

    expect(out.systems).toEqual([]);
    expect(out.complete, 'an empty list from a failed sweep is NOT a complete answer').toBe(false);
    expect(out.failure).not.toBeNull();
  });

  it('a genuinely empty region IS complete', async () => {
    // The other half of the same guard: if this reported `false`, every quiet corner of the galaxy
    // would carry a warning and members would learn to ignore it.
    const out = await systemsNear('Sol', 15, { fetchImpl: fakeFetch([[]]) });

    expect(out.systems).toEqual([]);
    expect(out.complete).toBe(true);
    expect(out.failure).toBeNull();
  });

  it('★ MANDATORY: a failed page is retried before being given up on ★', async () => {
    /*
     * The owner asked for one retry before anything is said, because the observed failure is a
     * transient stall — the same search succeeded moments later. Retrying costs one request and
     * turns most of these into a normal result the member never hears about.
     */
    let call = 0;
    const flakyOnce = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('transient stall');
      return { ok: true, json: async () => ({ results: [row()] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await systemsNear('Sol', 15, { fetchImpl: flakyOnce });

    expect(call, 'the first failure is retried, not surfaced').toBe(2);
    expect(out.systems).toHaveLength(1);
    expect(out.complete, 'a retry that worked is a complete sweep').toBe(true);
  });

  it('keeps the pages it did get when a later page dies for good', async () => {
    /*
     * A partial answer still beats none — the owner chose to see the candidates that were found.
     * What changes is that the list no longer claims to be the whole picture.
     */
    let call = 0;
    const dies = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({ results: Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` })) }),
        } as unknown as Response;
      }
      throw new Error('network went away');
    }) as unknown as typeof fetch;

    const out = await systemsNear('Sol', 15, { fetchImpl: dies });

    expect(out.systems).toHaveLength(50);
    expect(out.complete, 'fifty of an unknown total is not the whole answer').toBe(false);
  });

  it('names a timeout as a timeout, because that is the one that comes back', async () => {
    /*
     * An abort and a refused connection call for different reactions — "try again in a moment"
     * versus "the service is down". The observed production failure was the abort.
     */
    const stalls = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const out = await systemsNear('Sol', 15, { fetchImpl: stalls });
    expect(out.failure).toBe('timeout');
  });

  it('a page cap is a truncation too, not a clean finish', async () => {
    /*
     * `maxPages` stops a sweep mid-region exactly like a failure does. It was silent before for the
     * same reason everything else here was: the array had no room to say so.
     */
    const full = Array.from({ length: 50 }, (_, i) => row({ name: `S${i}` }));
    const out = await systemsNear('Sol', 15, {
      fetchImpl: fakeFetch([full, full, full, full]),
      maxPages: 2,
    });

    expect(out.systems).toHaveLength(100);
    expect(out.complete, 'stopped at the cap with more to come').toBe(false);
    expect(out.failure).toBe('page-cap');
  });
});
