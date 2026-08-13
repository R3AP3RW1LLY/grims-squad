import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EMPTY_LEDGER,
  MIN_MISSES,
  MIN_MISS_SPAN_HOURS,
  judgeSite,
  probeSystemViaSpansh,
  runSpanshWatch,
  type SiteLedger,
  type SystemProbe,
  type WatchDeps,
  type WatchedProject,
} from './spansh-watch.js';

/**
 * Deciding that a construction site has stopped existing, from somebody else's data.
 *
 * ★ WHY THERE IS NO BETTER SIGNAL, WHICH IS THE WHOLE REASON THIS FILE IS SO CAREFUL ★
 *
 * A finished installation or settlement is NOT DOCKABLE. The construction site ceases to exist, so
 * no journal event will ever mention it again, from anybody, ever. EDDN carries seven journal
 * schemas and not one of them is colonisation; Inara's two read endpoints are unrelated; Frontier
 * publishes nothing. The only remaining observable is the site VANISHING from a system's station
 * list, and Spansh is the aggregator that sees the most sources.
 *
 * ★ AND WHY ABSENCE IS THE MOST DANGEROUS KIND OF EVIDENCE THERE IS ★
 *
 * "Not in this response" and "not in the galaxy" are the same bytes. A refresh that has not run, a
 * partial nightly dump, a row served without its station list, a rate limit, a name rendered
 * differently — every one of them looks exactly like a finished build. And the cost is not
 * symmetric: a build closed a day late costs a day, while a build closed WRONGLY tells a squadron
 * to stop hauling to a site that is still live and still counting down.
 *
 * So every test below exists to hold one line: THE JOB MUST PREFER TO SAY NOTHING. Every gate in
 * `judgeSite` is a way of refusing to close, and the tests that matter most are the ones that prove
 * it refuses.
 */

const PROJECT = (over: Partial<WatchedProject> = {}): WatchedProject => ({
  projectId: '11111111-1111-1111-1111-111111111111',
  title: 'Irens Vision',
  systemName: 'HR 1183',
  stationName: 'Orbital Construction Site: Zeta',
  marketId: 3_999_001n,
  lastDepotAt: null,
  lastDeliveryAt: null,
  ...over,
});

const SEEN: SystemProbe = {
  answered: true,
  stations: [
    { name: 'Orbital Construction Site: Zeta', marketId: 3_999_001n },
    { name: 'Ehrlich Terminal', marketId: 3_700_500n },
    { name: 'Kondakov Port', marketId: 3_700_501n },
  ],
};

/** The same system, one poll later, with the site gone and its neighbours still listed. */
const MISSING: SystemProbe = {
  answered: true,
  stations: [
    { name: 'Ehrlich Terminal', marketId: 3_700_500n },
    { name: 'Kondakov Port', marketId: 3_700_501n },
  ],
};

const T0 = new Date('2026-08-01T00:00:00.000Z');
const hoursAfter = (h: number): Date => new Date(T0.getTime() + h * 3_600_000);

describe('judging one site against one Spansh answer', () => {
  it('records a sighting, and remembers the neighbours that witnessed it', () => {
    const v = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0);

    expect(v.kind).toBe('present');
    expect(v.ledger.seenAt).toBe(T0.toISOString());
    expect(v.ledger.misses).toBe(0);
    expect(v.ledger.missAt).toBeNull();
    /*
     * The witnesses are the point. A later absence only means anything if the OTHER stations we saw
     * alongside the site are still being reported — that is what tells us the row was refreshed
     * rather than served empty.
     */
    expect(v.ledger.witnesses).toContain('ehrlich terminal');
    expect(v.ledger.witnesses).toContain('kondakov port');
    expect(v.ledger.witnesses).not.toContain('orbital construction site zeta');
  });

  it('★ MANDATORY: a site we have NEVER seen at Spansh is never closed, however long it is absent ★', () => {
    /*
     * The positive control, and the single most important rule in the file.
     *
     * If Spansh has never once listed this construction site, its absence is not evidence of
     * anything: their sources may simply never have published it, our name for it may not be their
     * name for it, or the system may be one they hold thinly. Without a prior sighting, "absent"
     * means "we have no data", and closing on no data would close EVERY project on the first poll.
     */
    let ledger: SiteLedger = EMPTY_LEDGER;
    for (let poll = 0; poll < 20; poll += 1) {
      const v = judgeSite(PROJECT(), MISSING, ledger, hoursAfter(poll * 24));
      expect(v.kind).toBe('never-seen');
      expect(v.ledger.misses).toBe(0);
      ledger = v.ledger;
    }
  });

  it('★ MANDATORY: a probe that did not answer is not a miss ★', () => {
    /*
     * `systemsNear` swallows every failure and returns whatever it had collected so far, so a
     * timeout, a rate limit and a genuinely unknown system are indistinguishable at the call site.
     * Counting any of them as a miss would mean an hour of Spansh being down closes builds.
     */
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const v = judgeSite(PROJECT(), { answered: false, why: 'no answer' }, seen, hoursAfter(6));

    expect(v.kind).toBe('unknown');
    expect(v.ledger).toEqual(seen);
  });

  it('★ MANDATORY: a system answered with an EMPTY station list is not a miss ★', () => {
    // A row whose station list was not populated and a system with nothing in it are the same
    // bytes. We cannot tell them apart, so we decline to.
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const v = judgeSite(PROJECT(), { answered: true, stations: [] }, seen, hoursAfter(6));

    expect(v.kind).toBe('unknown');
    expect(v.ledger.misses).toBe(0);
  });

  it('★ MANDATORY: an absence with no surviving witness is not a miss ★', () => {
    /*
     * The site is gone from the list AND so is every station we saw beside it. That is not a build
     * finishing — a build finishing removes one station. It is Spansh handing us a different view
     * of the system, and we learn nothing from it.
     */
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const strangers: SystemProbe = {
      answered: true,
      stations: [{ name: 'Some Fleet Carrier XYZ-123', marketId: 3_800_000n }],
    };

    const v = judgeSite(PROJECT(), strangers, seen, hoursAfter(6));
    expect(v.kind).toBe('no-witness');
    expect(v.ledger.misses).toBe(0);
  });

  it('counts the first miss without acting on it', () => {
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const v = judgeSite(PROJECT(), MISSING, seen, hoursAfter(6));

    expect(v.kind).toBe('first-miss');
    expect(v.ledger.misses).toBe(1);
    expect(v.ledger.missAt).toBe(hoursAfter(6).toISOString());
    // The sighting is KEPT. It is the proof that absence means something here.
    expect(v.ledger.seenAt).toBe(T0.toISOString());
  });

  it(`★ MANDATORY: ${MIN_MISSES} misses minutes apart are not enough — they must span ${MIN_MISS_SPAN_HOURS}h ★`, () => {
    /*
     * Two polls a minute apart are one observation, not two: they read the same cached answer.
     * Without a wall-clock span, a daemon on a five-minute timer would close a build ten minutes
     * after a single bad dump landed.
     */
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const first = judgeSite(PROJECT(), MISSING, seen, hoursAfter(6)).ledger;
    const second = judgeSite(PROJECT(), MISSING, first, hoursAfter(6.1));

    expect(second.kind).toBe('too-soon');
    expect(second.ledger.misses).toBe(2);
  });

  it('closes only after two misses spanning the full window', () => {
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const first = judgeSite(PROJECT(), MISSING, seen, hoursAfter(6)).ledger;
    const v = judgeSite(PROJECT(), MISSING, first, hoursAfter(6 + MIN_MISS_SPAN_HOURS));

    expect(v.kind).toBe('gone');
    /*
     * Dated to the FIRST miss, not to now. That is our best estimate of when the site stopped being
     * reported, and it is the honest one: the build finished at some unknown moment before it, not
     * at the moment we happened to poll twice.
     */
    expect(v.goneSince?.toISOString()).toBe(hoursAfter(6).toISOString());
  });

  it('★ MANDATORY: a commander docking there after the first miss overrules Spansh ★', () => {
    /*
     * A depot reading exists only because somebody was physically docked at the construction site.
     * That is first-party evidence of the site EXISTING, and it beats a third-party aggregator not
     * listing it — absolutely, every time. The streak resets rather than being tolerated, because
     * the absence we were accumulating has been shown to be wrong.
     */
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const first = judgeSite(PROJECT(), MISSING, seen, hoursAfter(6)).ledger;

    const v = judgeSite(
      PROJECT({ lastDepotAt: hoursAfter(20) }),
      MISSING,
      first,
      hoursAfter(6 + MIN_MISS_SPAN_HOURS),
    );

    expect(v.kind).toBe('contradicted');
    expect(v.ledger.misses).toBe(0);
    expect(v.ledger.missAt).toBeNull();
  });

  it('a delivery after the first miss overrules it too', () => {
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const first = judgeSite(PROJECT(), MISSING, seen, hoursAfter(6)).ledger;

    const v = judgeSite(
      PROJECT({ lastDeliveryAt: hoursAfter(20) }),
      MISSING,
      first,
      hoursAfter(6 + MIN_MISS_SPAN_HOURS),
    );
    expect(v.kind).toBe('contradicted');
  });

  it('telemetry from BEFORE the first miss does not hold a close back', () => {
    // Of course it does not: a delivery yesterday is exactly what a build that has since finished
    // looks like. Only evidence NEWER than the absence contradicts the absence.
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const first = judgeSite(PROJECT({ lastDepotAt: T0 }), MISSING, seen, hoursAfter(6)).ledger;

    const v = judgeSite(
      PROJECT({ lastDepotAt: T0 }),
      MISSING,
      first,
      hoursAfter(6 + MIN_MISS_SPAN_HOURS),
    );
    expect(v.kind).toBe('gone');
  });

  it('a fresh sighting wipes an accumulating streak', () => {
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    const first = judgeSite(PROJECT(), MISSING, seen, hoursAfter(6)).ledger;
    const back = judgeSite(PROJECT(), SEEN, first, hoursAfter(12));

    expect(back.kind).toBe('present');
    expect(back.ledger.misses).toBe(0);
    expect(back.ledger.missAt).toBeNull();

    // ...and the clock restarts from the new absence, not from the old one.
    const again = judgeSite(PROJECT(), MISSING, back.ledger, hoursAfter(18));
    expect(again.kind).toBe('first-miss');
    expect(again.ledger.missAt).toBe(hoursAfter(18).toISOString());
  });

  it('refuses to judge a project with no station name recorded', () => {
    // There is nothing to look for. Reported as such rather than silently never closing, because
    // "we cannot judge this one" is a fact an operator can act on.
    const v = judgeSite(PROJECT({ stationName: null }), MISSING, EMPTY_LEDGER, T0);
    expect(v.kind).toBe('unjudgeable');
  });

  it('matches on the market id even when the name has changed under us', () => {
    // The market id is the join to reality (the same reasoning colony_projects.market_id carries).
    // Any way of finding the site counts as finding it, because finding it is the SAFE answer.
    const renamed: SystemProbe = {
      answered: true,
      stations: [{ name: 'Something Else Entirely', marketId: 3_999_001n }],
    };
    expect(judgeSite(PROJECT(), renamed, EMPTY_LEDGER, T0).kind).toBe('present');
  });

  it('matches names through case and punctuation', () => {
    const scruffy: SystemProbe = {
      answered: true,
      stations: [{ name: '  orbital construction site:   ZETA ', marketId: null }],
    };
    expect(judgeSite(PROJECT(), scruffy, EMPTY_LEDGER, T0).kind).toBe('present');
  });

  it('★ MANDATORY: a finished starport under its new name does NOT count as the site ★', () => {
    /*
     * "Orbital Construction Site: Zeta" becomes "Zeta" when it finishes, and that rename is exactly
     * the event we are trying to detect. A substring match would treat the finished port as the
     * still-live site and this job would never close an orbital build at all.
     *
     * The reason it is safe to be strict here is the positive control: if our name never matches
     * theirs, we never record a sighting, so we report `never-seen` and close nothing. Strict
     * matching can only ever cost us a close we do not make — never one we should not have.
     */
    const finished: SystemProbe = {
      answered: true,
      stations: [
        { name: 'Zeta', marketId: 3_700_777n },
        { name: 'Ehrlich Terminal', marketId: 3_700_500n },
      ],
    };
    const seen = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    expect(judgeSite(PROJECT(), finished, seen, hoursAfter(6)).kind).toBe('first-miss');
  });
});

// ---------------------------------------------------------------------------------------------

function harness(over: Partial<WatchDeps> & { projects?: WatchedProject[] } = {}) {
  const closed: Array<{ projectId: string; since: string }> = [];
  const probed: string[] = [];
  let stored: Record<string, SiteLedger> = {};

  const deps: WatchDeps = {
    open: async () => over.projects ?? [PROJECT()],
    probe:
      over.probe ??
      (async (system) => {
        probed.push(system);
        return MISSING;
      }),
    readLedger: async () => stored,
    writeLedger: async (l) => {
      stored = l;
    },
    close: async (p, since) => {
      closed.push({ projectId: p.projectId, since: since.toISOString() });
    },
    now: over.now ?? (() => T0),
  };

  return { deps, closed, probed, ledger: () => stored };
}

describe('the sweep', () => {
  it('★ MANDATORY: a dry run closes nothing ★', async () => {
    // The default, exactly as link-plans.ts beside it. Everything about this job is a judgement
    // call on somebody else's data, so the judgement gets read by a human before it is applied.
    const h = harness();
    const seenLedger = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    await h.deps.writeLedger({ [PROJECT().projectId]: { ...seenLedger, misses: 1, missAt: T0.toISOString() } });

    const report = await runSpanshWatch({ ...h.deps, now: () => hoursAfter(48) }, { live: false });

    expect(report.gone).toHaveLength(1);
    expect(h.closed).toEqual([]);
  });

  it('closes through the injected close when live', async () => {
    const h = harness();
    const seenLedger = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    await h.deps.writeLedger({ [PROJECT().projectId]: { ...seenLedger, misses: 1, missAt: T0.toISOString() } });

    const report = await runSpanshWatch({ ...h.deps, now: () => hoursAfter(48) }, { live: true });

    expect(report.closed).toBe(1);
    expect(h.closed).toEqual([{ projectId: PROJECT().projectId, since: T0.toISOString() }]);
  });

  it('★ MANDATORY: it records what Spansh said even in a dry run ★', async () => {
    /*
     * The same reasoning link-plans.ts uses for running `identifyBuildTypes` in a dry run: writing
     * down what a third party reported is an OBSERVATION, not a change to anybody's project.
     *
     * And here it is load-bearing. The rule needs two misses a day apart, so a dry run that could
     * not record the first one could never reach the second — the job would report "first miss"
     * for ever and the operator would never see the finding they are being asked to approve.
     */
    const h = harness();
    await runSpanshWatch(h.deps, { live: false });

    // Nothing was ever seen, so nothing is counted — but the entry exists and says so.
    expect(Object.keys(h.ledger())).toEqual([PROJECT().projectId]);
    expect(h.ledger()[PROJECT().projectId]?.misses).toBe(0);
  });

  it('probes each system once, however many projects are building in it', async () => {
    // GL-W c2-12 has six planned sites. Six polls of one system in one run is rude to a free
    // service and tells us nothing the first poll did not.
    const h = harness({
      projects: [
        PROJECT({ projectId: 'a', stationName: 'Site A' }),
        PROJECT({ projectId: 'b', stationName: 'Site B' }),
        PROJECT({ projectId: 'c', systemName: 'Sol', stationName: 'Site C' }),
      ],
    });

    const report = await runSpanshWatch(h.deps, { live: false });

    expect(h.probed).toEqual(['HR 1183', 'Sol']);
    expect(report.systemsProbed).toBe(2);
  });

  it('forgets projects that are no longer open', async () => {
    const h = harness();
    await h.deps.writeLedger({
      [PROJECT().projectId]: EMPTY_LEDGER,
      'closed-last-week': { ...EMPTY_LEDGER, misses: 4 },
    });

    await runSpanshWatch(h.deps, { live: false });
    expect(Object.keys(h.ledger())).toEqual([PROJECT().projectId]);
  });

  it('one system failing does not lose the rest of the sweep', async () => {
    const h = harness({
      projects: [PROJECT({ projectId: 'a' }), PROJECT({ projectId: 'b', systemName: 'Sol' })],
      probe: async (system) => {
        if (system === 'HR 1183') throw new Error('socket hang up');
        return MISSING;
      },
    });

    const report = await runSpanshWatch(h.deps, { live: false });

    expect(report.failed).toBe(1);
    expect(report.polled).toBe(2);
  });

  it('★ MANDATORY: a close that throws does not take the sweep down with it ★', async () => {
    const h = harness({
      projects: [PROJECT({ projectId: 'a' }), PROJECT({ projectId: 'b' })],
      close: async () => {
        throw new Error('database went away');
      },
    });
    const seenLedger = judgeSite(PROJECT(), SEEN, EMPTY_LEDGER, T0).ledger;
    await h.deps.writeLedger({
      a: { ...seenLedger, misses: 1, missAt: T0.toISOString() },
      b: { ...seenLedger, misses: 1, missAt: T0.toISOString() },
    });

    const report = await runSpanshWatch({ ...h.deps, now: () => hoursAfter(48) }, { live: true });
    expect(report.gone).toHaveLength(2);
    expect(report.closed).toBe(0);
    expect(report.failed).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------

describe('reading a system station list out of the Spansh client', () => {
  const answer = (results: unknown[]): typeof fetch =>
    vi.fn(async () => ({ ok: true, json: async () => ({ results }) }) as unknown as Response) as unknown as typeof fetch;

  it('recovers station names from the row the search already returns', async () => {
    const probe = await probeSystemViaSpansh('HR 1183', {
      fetchImpl: answer([
        {
          name: 'HR 1183',
          stations: [{ name: 'Ehrlich Terminal', market_id: 3_700_500 }, { name: 'Kondakov Port' }],
        },
      ]),
    });

    expect(probe.answered).toBe(true);
    expect(probe.answered ? probe.stations.map((s) => s.name) : []).toEqual([
      'Ehrlich Terminal',
      'Kondakov Port',
    ]);
    expect(probe.answered ? probe.stations[0]?.marketId : null).toBe(3_700_500n);
  });

  it('picks the reference system out of its neighbours by name', async () => {
    const probe = await probeSystemViaSpansh('HR 1183', {
      fetchImpl: answer([
        { name: 'Nearby Other', stations: [{ name: 'Wrong Station' }] },
        { name: 'hr 1183', stations: [{ name: 'Ehrlich Terminal' }] },
      ]),
    });

    expect(probe.answered ? probe.stations.map((s) => s.name) : []).toEqual(['Ehrlich Terminal']);
  });

  it('★ MANDATORY: no station NAMES means no answer, not an empty system ★', async () => {
    /*
     * The client keeps only `stations.length` from this response, so what those entries actually
     * contain is not something our own types promise. If a future payload holds ids or bare counts
     * instead of names, this job must degrade to "I do not know" — not to "every site in the galaxy
     * has vanished".
     */
    const probe = await probeSystemViaSpansh('HR 1183', {
      fetchImpl: answer([{ name: 'HR 1183', stations: [{ id: 1 }, { id: 2 }] }]),
    });
    expect(probe.answered).toBe(false);
  });

  it('a system the search does not return at all is no answer', async () => {
    const probe = await probeSystemViaSpansh('HR 1183', { fetchImpl: answer([]) });
    expect(probe.answered).toBe(false);
  });

  it('a failing request is no answer, never an absence', async () => {
    const probe = await probeSystemViaSpansh('HR 1183', {
      fetchImpl: vi.fn(async () => {
        throw new Error('network went away');
      }) as unknown as typeof fetch,
    });
    expect(probe.answered).toBe(false);
  });
});

describe('how it closes', () => {
  it('★ MANDATORY: closing goes through completeColonyProject and nowhere else ★', () => {
    /*
     * Four other paths end a build — close(), the depot's complete flag, the 100%-delivered rule
     * and the report-built endpoint — and every one of them reaches `completeColonyProject`,
     * because the guarded `updateMany` inside it is what makes the squadron hear about a finished
     * build EXACTLY ONCE however many processes noticed in the same minute.
     *
     * A fifth path that wrote `completed_at` itself would announce nothing at all, or would race
     * the daemon into announcing twice. This test is the join between that rule and this file.
     */
    const src = readFileSync(new URL('./spansh-watch.ts', import.meta.url), 'utf8');

    expect(src).toContain('completeColonyProject');
    expect(src).not.toMatch(/colonyProject\.update/);
    expect(src).not.toMatch(/UPDATE\s+colony_projects/i);
  });
});
