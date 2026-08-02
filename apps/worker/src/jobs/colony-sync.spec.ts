import { describe, it, expect } from 'vitest';
import {
  syncColonyProjects,
  commodityName,
  type ColonyStore,
  type ContributionReading,
  type DepotReading,
  type NeedRow,
  type TrackedProject,
} from './colony-sync.js';

/**
 * Turning colonisation journal events into the squadron's own records.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "keep our own full records too", built self-contained after Ravencolonial turned out to hold
 * nothing we cannot read ourselves.
 *
 * A project board is a promise about what a build still needs and who hauled to it. What this suite
 * protects is that the promise stays true without anybody tending it: that needs are replaced
 * rather than drifted, that a finished build closes itself, and that a delivery is counted exactly
 * once no matter how many times the job runs.
 */

const PROJECT = (over: Partial<TrackedProject> = {}): TrackedProject => ({
  id: 'p1',
  marketId: 3_700_001n,
  completedAt: null,
  ...over,
});

const DEPOT = (over: Partial<DepotReading> = {}): DepotReading => ({
  marketId: 3_700_001n,
  observedAt: new Date('2026-08-02T10:00:00Z'),
  complete: false,
  failed: false,
  resources: [{ commodity: 'Steel', required: 5_000, provided: 1_200 }],
  ...over,
});

const CONTRIB = (over: Partial<ContributionReading> = {}): ContributionReading => ({
  marketId: 3_700_001n,
  userId: 'u1',
  deliveredAt: new Date('2026-08-02T09:00:00Z'),
  eventKey: 'abc',
  items: [{ commodity: 'Steel', amount: 400 }],
  ...over,
});

function harness(opts: {
  projects?: TrackedProject[];
  depot?: DepotReading | null;
  contributions?: ContributionReading[];
  /** Event keys the ledger already holds, so recordContribution reports a duplicate. */
  seen?: Set<string>;
  throwOn?: string;
}) {
  const needs: Array<{ projectId: string; needs: readonly NeedRow[] }> = [];
  const completed: Array<{ projectId: string; at: Date }> = [];
  const recorded: Array<{ projectId: string; commodity: string; amount: number }> = [];
  const seen = opts.seen ?? new Set<string>();

  const store: ColonyStore = {
    tracked: async () => opts.projects ?? [PROJECT()],
    latestDepot: async (m) => {
      if (opts.throwOn === 'depot') throw new Error('malformed payload');
      return opts.depot === undefined ? DEPOT({ marketId: m }) : opts.depot;
    },
    replaceNeeds: async (projectId, n) => {
      needs.push({ projectId, needs: n });
    },
    markComplete: async (projectId, at) => {
      completed.push({ projectId, at });
    },
    contributionsFor: async () => opts.contributions ?? [],
    recordContribution: async (projectId, c, item) => {
      const key = `${c.eventKey}|${item.commodity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      recorded.push({ projectId, commodity: item.commodity, amount: item.amount });
      return true;
    },
  };

  return { store, needs, completed, recorded, seen };
}

describe('a project’s needs', () => {
  it('MANDATORY: are REPLACED from the newest reading, not adjusted', async () => {
    /*
     * The depot reports the remaining need for every commodity at once, so the newest reading is
     * the whole truth. Applying these as deltas would drift permanently the first time a member
     * hauled with the companion app closed — and it would drift silently, in the direction of
     * claiming a site needs more than it does.
     */
    const h = harness({ depot: DEPOT({ resources: [{ commodity: 'Steel', required: 5_000, provided: 1_200 }] }) });

    await syncColonyProjects(h.store);

    expect(h.needs).toHaveLength(1);
    expect(h.needs[0]?.needs).toEqual([{ commodity: 'Steel', remaining: 3_800, required: 5_000 }]);
  });

  it('MANDATORY: never reports a negative remainder', async () => {
    // An over-delivered site reports more provided than required. "-40 tonnes still needed" on a
    // progress bar is worse than saying nothing.
    const h = harness({
      depot: DEPOT({ resources: [{ commodity: 'Steel', required: 100, provided: 140 }] }),
    });

    await syncColonyProjects(h.store);

    expect(h.needs[0]?.needs).toEqual([{ commodity: 'Steel', remaining: 0, required: 100 }]);
  });

  it('counts a project nobody has docked at, rather than emptying it', async () => {
    /*
     * Posted, but no reading yet — normal for a site the member is on their way to. It must not be
     * indistinguishable from a site that needs nothing, which is what writing an empty needs list
     * would make it look like.
     */
    const h = harness({ depot: null });

    const report = await syncColonyProjects(h.store);

    expect(report.awaitingFirstVisit).toBe(1);
    expect(h.needs).toEqual([]);
  });
});

describe('closing a project', () => {
  it('closes it when the game says the build is complete', async () => {
    // A finished build whose card still reads "8,940 of 21,620" is how a board stops being trusted.
    const h = harness({ depot: DEPOT({ complete: true }) });

    const report = await syncColonyProjects(h.store);

    expect(report.completed).toBe(1);
    expect(h.completed[0]?.projectId).toBe('p1');
  });

  it('closes it when the build FAILED too', async () => {
    // The site is equally gone. Leaving it open would have members hauling to somewhere that no
    // longer exists — worse than an out-of-date number.
    const h = harness({ depot: DEPOT({ failed: true }) });

    expect((await syncColonyProjects(h.store)).completed).toBe(1);
  });

  it('does not close one that is already closed', async () => {
    // Idempotence. The job runs on a schedule and by hand; re-closing would rewrite completedAt to
    // a later timestamp every run, quietly moving when the build finished.
    const h = harness({
      projects: [PROJECT({ completedAt: new Date('2026-08-01T00:00:00Z') })],
      depot: DEPOT({ complete: true }),
    });

    expect((await syncColonyProjects(h.store)).completed).toBe(0);
    expect(h.completed).toEqual([]);
  });
});

describe('the contribution ledger', () => {
  it('MANDATORY: counts a delivery exactly once across repeated runs', async () => {
    /*
     * The whole reason there is no watermark. The job is safe to run twice, and the ledger's unique
     * key is what makes that true — at the database level, not by agreement between callers.
     */
    const h = harness({ contributions: [CONTRIB()] });

    const first = await syncColonyProjects(h.store);
    const second = await syncColonyProjects(h.store);

    expect(first.contributionsAdded).toBe(1);
    expect(second.contributionsAdded).toBe(0);
    expect(h.recorded).toHaveLength(1);
  });

  it('MANDATORY: keeps every commodity from ONE event', async () => {
    /*
     * A single contribution event can hand over steel AND titanium. Keyed on the telemetry event id
     * alone, the first would insert and the rest would be swallowed as duplicates — under-counting
     * exactly the deliveries this exists to measure, with nothing visibly broken.
     */
    const h = harness({
      contributions: [
        CONTRIB({
          items: [
            { commodity: 'Steel', amount: 400 },
            { commodity: 'Titanium', amount: 120 },
          ],
        }),
      ],
    });

    const report = await syncColonyProjects(h.store);

    expect(report.contributionsAdded).toBe(2);
    expect(h.recorded.map((r) => r.commodity)).toEqual(['Steel', 'Titanium']);
  });

  it('skips empty deliveries rather than filing them', async () => {
    // The journal has been seen to emit zero-amount entries. A ledger row of nothing still shows up
    // as a delivery on somebody's tally.
    const h = harness({ contributions: [CONTRIB({ items: [{ commodity: 'Steel', amount: 0 }] })] });

    expect((await syncColonyProjects(h.store)).contributionsAdded).toBe(0);
  });

  it('MANDATORY: records deliveries even when no depot reading exists', async () => {
    /*
     * A member can deliver to a site nobody has read the depot of. Losing their haul because of
     * that ordering would be the most annoying bug this feature could have, and the least visible.
     */
    const h = harness({ depot: null, contributions: [CONTRIB()] });

    const report = await syncColonyProjects(h.store);

    expect(report.contributionsAdded).toBe(1);
    expect(report.awaitingFirstVisit).toBe(1);
  });
});

describe('one bad project', () => {
  it('does not cost the others their update', async () => {
    const h = harness({
      projects: [PROJECT({ id: 'p1' }), PROJECT({ id: 'p2', marketId: 2n })],
      throwOn: 'depot',
    });

    const report = await syncColonyProjects(h.store);

    expect(report.failed).toBe(2);
    expect(report.projects).toBe(2);
  });
});

describe('naming a commodity', () => {
  it('MANDATORY: prefers the localised name, because that is what the market joins on', () => {
    /*
     * `market_entries.commodity` holds display names, and a project's shopping list joins its needs
     * against the market to answer "where do I buy this". A symbol here joins against nothing and
     * the shopping list comes back empty with no error.
     */
    expect(commodityName({ name: '$steel_name;', localised: 'Steel' })).toBe('Steel');
  });

  it('cleans the symbol into something readable when there is no localised name', () => {
    // A commodity we cannot match is still one a member has to go and find. A name they can read
    // beats a token they cannot.
    expect(commodityName({ name: '$steel_name;', localised: null })).toBe('Steel');
    expect(commodityName({ name: '$ceramic_composites_name;', localised: '' })).toBe(
      'Ceramic composites',
    );
  });

  it('gives back nothing when there is nothing, so the caller can drop the row', () => {
    expect(commodityName({ name: null, localised: null })).toBe('');
  });
});
