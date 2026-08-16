import { describe, expect, it } from 'vitest';
import { CapiAuthError } from '@grims/ed-clients';
import type { CarrierManifest } from '@grims/ed-clients';
import {
  CAPI_MIN_SPACING_MS,
  pollCapiCarriers,
  type CarrierCandidate,
  type CarrierPollStore,
  type CargoLine,
} from './capi-carrier-poll.js';

/**
 * Asking Frontier what the squadron's carriers are holding.
 *
 * ★ WHAT MAKES THIS DIFFERENT FROM EVERY OTHER SOURCE ★
 *
 * The mirror, the journal and a crew member's hand can all only UNDERSTATE — none of them can tell
 * "sold" from "nobody looked". Frontier answers with the whole manifest, so absent means absent.
 *
 * That one property is the entire reason this job exists, and it is also the property that makes it
 * dangerous: a source allowed to say "empty" will empty the boards if it ever says so by accident.
 * Most of what is asserted below is about the difference between "Frontier said nothing is aboard"
 * and "we failed to ask".
 */

const CANDIDATE: CarrierCandidate = { userId: 'u1', cmdrName: 'RUSTY' };

const manifest = (cargo: readonly CargoLine[], callsign = 'W8K-W1Y'): CarrierManifest => ({
  callsign,
  cargo,
});

interface Recorded {
  readonly marketId: string;
  readonly ownerId: string;
  readonly lines: readonly CargoLine[];
}

function harness(over: {
  candidates?: readonly CarrierCandidate[];
  token?: string | null;
  marketId?: string | null;
  attached?: boolean;
  fetch?: () => Promise<CarrierManifest | null>;
  maxRequests?: number;
}) {
  const written: Recorded[] = [];
  const slept: number[] = [];

  const store: CarrierPollStore = {
    candidates: async () => over.candidates ?? [CANDIDATE],
    accessToken: async () => (over.token === undefined ? 'tok' : over.token),
    marketIdForCallsign: async () => (over.marketId === undefined ? '3713238272' : over.marketId),
    isAttachedToLiveBuild: async () => over.attached !== false,
    replaceCapiCargo: async (input) => {
      written.push({ marketId: input.marketId, ownerId: input.ownerId, lines: input.lines });
    },
  };

  const run = () =>
    pollCapiCarriers({
      store,
      fetchCarrier: over.fetch ?? (async () => manifest([{ commodity: 'Titanium', tonnes: 480 }])),
      now: () => new Date('2026-08-16T12:00:00Z'),
      sleep: async (ms) => {
        slept.push(ms);
      },
      ...(over.maxRequests === undefined ? {} : { maxRequests: over.maxRequests }),
    });

  return { run, written, slept };
}

describe('what it stores', () => {
  it('★ MANDATORY: the manifest reaches the hub against the right carrier and owner ★', async () => {
    const h = harness({});
    const report = await h.run();

    expect(report.stored).toBe(1);
    expect(h.written).toEqual([
      {
        marketId: '3713238272',
        ownerId: 'u1',
        lines: [{ commodity: 'Titanium', tonnes: 480 }],
      },
    ]);
  });

  it('★ MANDATORY: an EMPTY manifest is stored as empty, not skipped ★', async () => {
    /*
     * The whole point of asking Frontier. Skipping an empty answer would leave the journal's
     * fortnight-old 20,000 t standing, and the board would keep promising cargo that was sold days
     * ago — which is exactly the wasted trip this module keeps reinventing under new names.
     */
    const h = harness({ fetch: async () => manifest([]) });
    const report = await h.run();

    expect(report.stored).toBe(1);
    expect(h.written).toEqual([{ marketId: '3713238272', ownerId: 'u1', lines: [] }]);
  });

  it('★ MANDATORY: only carriers attached to a LIVE build ★', async () => {
    // The scope the owner chose. A carrier on no live build is not written at all.
    const h = harness({ attached: false });
    const report = await h.run();

    expect(h.written).toEqual([]);
    expect(report.stored).toBe(0);
    expect(report.outcomes[0]?.result).toBe('not-attached');
  });

  it('★ MANDATORY: a callsign the catalogue cannot place stores NOTHING ★', async () => {
    /*
     * Frontier knows carriers our catalogue has not seen. Inventing a market id would write rows
     * nothing can join to, and every board would go on showing the old figure while a table quietly
     * filled with orphans.
     */
    const h = harness({ marketId: null });
    await h.run();

    expect(h.written).toEqual([]);
  });

  it('a member with no carrier is an ordinary outcome, not a failure', async () => {
    // Most members do not own one and Frontier answers 404. Treating that as an error would fill
    // the log with failures from healthy members and bury the one that matters.
    const h = harness({ fetch: async () => null });
    const report = await h.run();

    expect(report.outcomes[0]?.result).toBe('no-carrier');
    expect(h.written).toEqual([]);
  });
});

describe('when Frontier will not answer', () => {
  it('★ MANDATORY: a failure NEVER clears a hold ★', async () => {
    /*
     * The dangerous one, and the reason this job is written with a store that REPLACES. "Frontier
     * is broken" and "the carrier is empty" are one keystroke apart here and indistinguishable on
     * every board downstream — writing an empty manifest on an HTTP 500 would blank the carrier
     * column across the whole squadron.
     */
    const h = harness({
      fetch: async () => {
        throw new CapiAuthError('refused', 'Frontier returned http 500', 500);
      },
    });
    const report = await h.run();

    expect(h.written, 'nothing may be written when the answer never arrived').toEqual([]);
    expect(report.outcomes[0]?.result).toBe('failed');
  });

  it('★ MANDATORY: a rate limit STOPS the run rather than spending the rest of it ★', async () => {
    /*
     * The limit is the squadron's, not one member's. Carrying on spends the remaining budget
     * discovering it is spent — and the next run, which might carry the build somebody is actually
     * hauling to, is refused for it.
     */
    const h = harness({
      candidates: [CANDIDATE, { userId: 'u2', cmdrName: 'PEBBLE' }, { userId: 'u3', cmdrName: 'X' }],
      fetch: async () => {
        throw new CapiAuthError('rate_limited', 'Frontier is rate limiting us', 429);
      },
    });
    const report = await h.run();

    expect(report.asked, 'it must not keep asking').toBe(1);
    expect(report.stoppedBecause).toBe('rate-limited');
  });

  it('a dead grant costs no request at all', async () => {
    // The store marks it stale; asking would spend a request proving what we have been told.
    const h = harness({ token: null });
    const report = await h.run();

    expect(report.asked).toBe(0);
    expect(report.outcomes[0]?.result).toBe('no-token');
  });

  it('one member failing does not stop the next', async () => {
    // A single broken grant taking down the run would mean one member's problem silently freezing
    // every carrier figure on the boards.
    let call = 0;
    const h = harness({
      candidates: [CANDIDATE, { userId: 'u2', cmdrName: 'PEBBLE' }],
      fetch: async () => {
        call += 1;
        if (call === 1) throw new CapiAuthError('invalid_grant', 'revoked', 401);
        return manifest([{ commodity: 'Steel', tonnes: 900 }]);
      },
    });
    const report = await h.run();

    expect(report.stored).toBe(1);
    expect(report.outcomes.map((o) => o.result)).toEqual(['failed', 'stored']);
  });
});

describe('pacing the shared limit', () => {
  it('★ MANDATORY: requests are spaced ★', async () => {
    const h = harness({
      candidates: [CANDIDATE, { userId: 'u2', cmdrName: 'PEBBLE' }, { userId: 'u3', cmdrName: 'X' }],
    });
    await h.run();

    expect(h.slept).toEqual([CAPI_MIN_SPACING_MS, CAPI_MIN_SPACING_MS]);
  });

  it('the floor is between REQUESTS, so a skipped member does not buy a pause', async () => {
    // Waiting 1.1s after a member we never asked about is a second of nothing, repeated once per
    // member with a dead grant — and those accumulate on exactly the runs that are already slow.
    const h = harness({ token: null, candidates: [CANDIDATE, { userId: 'u2', cmdrName: 'P' }] });
    await h.run();

    expect(h.slept).toEqual([]);
  });

  it('★ MANDATORY: one run cannot spend the whole budget ★', async () => {
    /*
     * A cap, not a queue. Without it a large squadron's run consumes the limit and the NEXT run is
     * refused outright — so the failure becomes "everything stops", which nothing reports, instead
     * of "some carriers are late", which the report says out loud.
     */
    const many = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, cmdrName: `C${i}` }));
    const h = harness({ candidates: many, maxRequests: 3 });
    const report = await h.run();

    expect(report.asked).toBe(3);
    expect(report.stoppedBecause).toBe('cap-reached');
  });
});
