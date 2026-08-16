import { describe, expect, it } from 'vitest';
import { buildOverlayData, type OverlayInput } from './overlay-data.js';
import type { DockedAt } from './docked.js';
import type { CurrentBuild } from './hub-colony.js';

/**
 * The overlay payload.
 *
 * ★ WHAT THESE TESTS ARE REALLY GUARDING ★
 *
 * Not the arithmetic — that is three reduces. The thing worth pinning is which slices are allowed
 * to be NULL, because the panels say something different and true for each, and the cheap mistake
 * is to send an empty object so a panel "has data". `cargo: { items: [], used: 0 }` renders "Hold
 * empty.", which is a claim about somebody's ship that this app cannot currently make.
 */

const NOW = Date.parse('2026-08-02T22:00:00Z');

function dockedAt(overrides: Partial<DockedAt> = {}): DockedAt {
  return {
    marketId: '4359491587',
    stationName: 'Planetary Construction Site: Harry’s Dysfunctional Society',
    systemName: 'Hyades Sector XJ-Z c18',
    at: new Date(NOW - 60_000).toISOString(),
    site: {
      progress: 0.42,
      complete: false,
      failed: false,
      resources: [
        { commodity: 'Steel', required: 60_984, provided: 40_920 },
        { commodity: 'Aluminium', required: 42_282, provided: 16_526 },
        { commodity: 'Titanium', required: 34_560, provided: 34_560 },
      ],
    },
    ...overrides,
  } as DockedAt;
}

function input(overrides: Partial<OverlayInput> = {}): OverlayInput {
  return {
    dock: dockedAt(),
    sending: false,
    lastTransferAt: 0,
    gameRunning: true,
    // Null by default: most cases here are about the build panel, and "we could not read a hold" is
    // the honest resting state rather than an empty one.
    hold: null,
    capacity: null,
    // Null by default too: no current build marked is the journal-fallback state, which is what
    // every pre-existing case below was written against.
    currentProject: null,
    trip: null,
    now: NOW,
    ...overrides,
  };
}

/** The hub's answer for a marked current build. The fixture project is the docked site above. */
function currentBuild(overrides: Partial<CurrentBuild> = {}): CurrentBuild {
  return {
    projectId: 'p-1',
    title: 'Harry’s Dysfunctional Society',
    systemName: 'Hyades Sector XJ-Z c18',
    stationName: 'Planetary Construction Site: Harry’s Dysfunctional Society',
    marketId: '4359491587',
    isPriority: true,
    progress: { delivered: 100_000, required: 137_826 },
    needs: [
      { commodity: 'Steel', remaining: 18_000, required: 60_984, observedAt: null },
      { commodity: 'Aluminium', remaining: 19_826, required: 42_282, observedAt: null },
      { commodity: 'Titanium', remaining: 0, required: 34_560, observedAt: null },
    ],
    haulers: [
      { name: 'Grim', tonnes: 60_000 },
      { name: 'Harry', tonnes: 40_000 },
    ],
    ...overrides,
  };
}

describe('the overlay payload', () => {
  it('reports what the site still needs, and drops what is finished', () => {
    const { build } = buildOverlayData(input());

    /*
     * The row grew a grid in 2026-08-15 — outstanding, in your hold, on carriers, still to buy.
     * `toMatchObject` rather than `toEqual` so this test keeps asserting the thing it is named for
     * (what is still needed, and that finished lines are dropped) instead of failing every time a
     * column is added. The columns themselves are asserted in their own test below.
     */
    expect(build?.needs).toMatchObject([
      { commodity: 'Steel', remaining: 20_064, required: 60_984 },
      { commodity: 'Aluminium', remaining: 25_756, required: 42_282 },
    ]);
    // Titanium is done. A completed line is a row of noise on a panel over a cockpit.
    expect(build?.needs.map((n) => n.commodity)).not.toContain('Titanium');
  });

  it('★ MANDATORY: at a depot it reports YOUR hold, and says it does not know about carriers ★', () => {
    /*
     * ★ SQUADRON OWNER, 2026-08-15 ★
     *
     * "show What is actually remaining vs what is in player cargo holds vs what it actually in
     * assigned fleet carrier holds."
     *
     * This is the JOURNAL path — docked at a construction depot, reading the pad. It knows the
     * member's own hold, because that is read off their machine, and it has never heard of a
     * carrier.
     *
     * So `knowsCarriers` is false, and the panel prints a mark rather than `0 t`. A zero there is a
     * CLAIM — "no carrier holds any" — and we did not ask. The same distinction `needsFreshness`
     * draws between "none" and "we have not looked".
     */
    const { build } = buildOverlayData(input());
    const steel = build?.needs.find((n) => n.commodity === 'Steel');

    expect(steel?.knowsCarriers, 'a depot cannot know what a carrier holds').toBe(false);
    expect(steel?.onCarriers).toBe(0);
    expect(steel?.stillToBuy, 'nothing in the hold, so all of it is still to buy').toBe(20_064);
  });

  it('★ MANDATORY: what is already in your hold comes OFF what you still have to buy ★', () => {
    /*
     * ★ THE WHOLE POINT OF THE COLUMN ★
     *
     * A member sitting on 800 t of Steel must not be told to buy the full outstanding figure. That
     * is the mistake this grid exists to stop — it sends somebody to a market for tonnage they are
     * already carrying, which is the same wasted trip the owner has reported twice under other
     * names.
     *
     * Written against a hold that actually CONTAINS the commodity, because a fixture with an empty
     * hold cannot tell `remaining - inHold` apart from `remaining` — mutation testing found exactly
     * that hole in the first version of these tests.
     */
    const { build } = buildOverlayData(
      input({
        hold: {
          used: 800,
          at: '2026-08-03T17:00:00Z',
          items: [{ commodity: 'Steel', count: 800, wanted: true }],
        },
      }),
    );

    const steel = build?.needs.find((n) => n.commodity === 'Steel');

    expect(steel?.inHold, 'read off the member’s own machine').toBe(800);
    expect(steel?.stillToBuy, '20,064 outstanding less the 800 already aboard').toBe(19_264);

    const aluminium = build?.needs.find((n) => n.commodity === 'Aluminium');
    expect(aluminium?.inHold, 'none of this one aboard').toBe(0);
    expect(aluminium?.stillToBuy).toBe(25_756);
  });

  it('totals the whole site, including what is already finished', () => {
    const { build } = buildOverlayData(input());

    // Delivered and required span EVERY commodity, unlike `needs` — the progress bar is about the
    // build, not about what is left to do.
    expect(build?.delivered).toBe(92_006);
    expect(build?.required).toBe(137_826);
  });

  it('never reports a negative remainder on an over-delivered site', () => {
    const over = dockedAt({
      site: {
        progress: 1,
        complete: false,
        failed: false,
        resources: [{ commodity: 'Steel', required: 100, provided: 140 }],
      },
    } as Partial<DockedAt>);

    const { build } = buildOverlayData(input({ dock: over }));
    // Dropped rather than shown as -40: the game does report this, and "-40 t still needed" on an
    // overlay is worse than saying nothing.
    expect(build?.needs).toEqual([]);
  });

  it('strips Frontier’s construction-site prefix from the title', () => {
    const { build } = buildOverlayData(input());
    expect(build?.title).toBe('Harry’s Dysfunctional Society');
  });

  it('forgets a dock that is no longer plausibly current', () => {
    const stale = dockedAt({ at: new Date(NOW - 13 * 60 * 60_000).toISOString() });

    // Thirteen hours old, past the twelve-hour rule. An overlay confidently reporting a build
    // somebody left yesterday is worse than one that admits it does not know.
    expect(buildOverlayData(input({ dock: stale })).build).toBeNull();
  });

  it('says nothing about a dock that is not a construction site', () => {
    expect(buildOverlayData(input({ dock: dockedAt({ site: null }) })).build).toBeNull();
    expect(buildOverlayData(input({ dock: null })).build).toBeNull();
  });

  /* ------------------------------------------------------- the current build */

  it('follows the current build wherever the member is — no dock needed at all', () => {
    /*
     * ★ THE OWNER'S COMPLAINT THIS EXISTS FOR ★
     *
     * The panel used to empty the moment the member undocked, which is most of a hauling loop.
     * With a current build marked, the hub's whole-project answer fills it anywhere.
     */
    const { build } = buildOverlayData(input({ dock: null, currentProject: currentBuild() }));

    expect(build?.title).toBe('Harry’s Dysfunctional Society');
    expect(build?.fromHub).toBe(true);
    expect(build?.delivered).toBe(100_000);
    expect(build?.required).toBe(137_826);
    expect(build?.haulers).toBe(2);
    // Finished lines are dropped here exactly as on the depot path — Titanium is done.
    expect(build?.needs.map((n) => n.commodity)).toEqual(['Steel', 'Aluminium']);
  });

  it('prefers the depot reading when docked at the current build itself', () => {
    // The fixture dock IS the current build's market. The pad's own heartbeat is seconds fresher
    // than the hub's copy, so its numbers win while the member is standing there.
    const { build } = buildOverlayData(input({ currentProject: currentBuild() }));

    expect(build?.fromHub).toBe(false);
    expect(build?.delivered).toBe(92_006);
    // But the project's TITLE and crew come from the hub — no heartbeat carries either.
    expect(build?.title).toBe('Harry’s Dysfunctional Society');
    expect(build?.haulers).toBe(2);
  });

  it('keeps the hub view when docked at some OTHER construction site', () => {
    // A member restocking at a different depot is still on the business of THEIR build; the panel
    // does not defect to whatever pad they happen to be parked on.
    const elsewhere = dockedAt({ marketId: '999999' } as Partial<DockedAt>);
    const { build } = buildOverlayData(input({ dock: elsewhere, currentProject: currentBuild() }));

    expect(build?.fromHub).toBe(true);
    expect(build?.delivered).toBe(100_000);
  });

  it('falls back to the journal-docked view when no current build is set', () => {
    // The behaviour the panel has always had, untouched — including for unposted sites.
    const { build } = buildOverlayData(input({ currentProject: null }));
    expect(build?.fromHub).toBe(false);
    expect(build?.delivered).toBe(92_006);
  });

  /* ------------------------------------------------------------ honest nulls */

  it('sends no cargo at all when it could not read a hold', () => {
    /*
     * ★ THE ONE THAT MATTERS ★
     *
     * The panel reads `items: []` as "Hold empty." and `null` as "Waiting for your hold." Telling a
     * member with 1,040 tonnes aboard that they are carrying nothing is the kind of wrong that makes
     * somebody stop trusting the whole app, so the distinction survives all the way from the file
     * read to the panel.
     */
    expect(buildOverlayData(input({ hold: null })).cargo).toBeNull();
  });

  it('reports a real hold, biggest first, with the capacity', () => {
    const { cargo } = buildOverlayData(
      input({
        hold: {
          used: 1040,
          at: '2026-08-03T17:00:00Z',
          items: [
            { commodity: 'Steel', count: 800, wanted: false },
            { commodity: 'Titanium', count: 240, wanted: false },
          ],
        },
        capacity: 1040,
      }),
    );

    expect(cargo?.used).toBe(1040);
    expect(cargo?.capacity).toBe(1040);
    expect(cargo?.items.map((i) => i.commodity)).toEqual(['Steel', 'Titanium']);
  });

  it('marks what the site in front of you actually wants', () => {
    /*
     * The reason the panel is worth drawing at all. The game already shows a hold; what it cannot
     * show is which of it the build you are docked at is asking for — so somebody hauling a mixed
     * load knows what to hand over and what they are carrying for nothing.
     */
    const { cargo } = buildOverlayData(
      input({
        hold: {
          used: 1000,
          at: null,
          items: [
            { commodity: 'Steel', count: 600, wanted: false },
            { commodity: 'Gold', count: 400, wanted: false },
          ],
        },
      }),
    );

    expect(cargo?.items.find((i) => i.commodity === 'Steel')?.wanted).toBe(true);
    // Gold is not on the site's list, so it is dead weight and says so.
    expect(cargo?.items.find((i) => i.commodity === 'Gold')?.wanted).toBe(false);
  });

  it('does not mark a commodity the build has already had enough of', () => {
    // Titanium is fully delivered in the fixture, so carrying more of it is carrying it for nothing.
    const { cargo } = buildOverlayData(
      input({
        hold: {
          used: 100,
          at: null,
          items: [{ commodity: 'Titanium', count: 100, wanted: false }],
        },
      }),
    );

    expect(cargo?.items[0]?.wanted).toBe(false);
  });

  it('marks the hold against the CURRENT build when away from the site', () => {
    // Loading up three systems away: the hub's needs list says which of the hold the build is
    // actually waiting for, exactly as the depot list does when docked.
    const { cargo } = buildOverlayData(
      input({
        dock: null,
        currentProject: currentBuild(),
        hold: {
          used: 700,
          at: null,
          items: [
            { commodity: 'Steel', count: 600, wanted: false },
            { commodity: 'Gold', count: 100, wanted: false },
          ],
        },
      }),
    );

    expect(cargo?.items.find((i) => i.commodity === 'Steel')?.wanted).toBe(true);
    expect(cargo?.items.find((i) => i.commodity === 'Gold')?.wanted).toBe(false);
  });

  /* --------------------------------------------------- what was paid, and the receipt */

  it('prices each hold line from the watched lots, and mined cargo honestly has no price', () => {
    const { cargo } = buildOverlayData(
      input({
        hold: {
          used: 740,
          at: null,
          items: [
            { commodity: 'Gold', count: 720, wanted: false },
            { commodity: 'Painite', count: 20, wanted: false },
          ],
        },
        trip: {
          lots: { gold: { units: 720, paid: 33_840_000 } },
          lastSale: null,
          since: 'dock',
        },
      }),
    );
    const gold = cargo?.items.find((i) => i.commodity === 'Gold');
    const painite = cargo?.items.find((i) => i.commodity === 'Painite');
    expect(gold?.paid).toBe(33_840_000);
    // Mined: no watched buy, no invented zero.
    expect(painite?.paid).toBeNull();
    expect(cargo?.totalPaid).toBe(33_840_000);
  });

  it('keeps the last sale on screen even over an empty hold — the till receipt persists', () => {
    const { cargo } = buildOverlayData(
      input({
        hold: { used: 0, at: null, items: [] },
        trip: {
          lots: {},
          lastSale: { commodity: 'gold', units: 720, sale: 43_200_000, paid: 33_840_000 },
          since: 'dock',
        },
      }),
    );
    expect(cargo?.lastSale?.sale).toBe(43_200_000);
    expect(cargo?.totalPaid).toBe(0);
  });

  it('sends no route, because nothing records the run somebody picked', () => {
    expect(buildOverlayData(input()).route).toBeNull();
  });

  /* ----------------------------------------------------------------- status */

  it('reports the upload light from the live flag, not from the last pass', () => {
    expect(buildOverlayData(input({ sending: true })).status?.sending).toBe(true);
    expect(buildOverlayData(input({ sending: false })).status?.sending).toBe(false);
  });

  it('has no last upload before there has been one', () => {
    expect(buildOverlayData(input({ lastTransferAt: 0 })).status?.lastUploadAt).toBeNull();
    expect(buildOverlayData(input({ lastTransferAt: NOW })).status?.lastUploadAt).toBe(
      new Date(NOW).toISOString(),
    );
  });

  it('claims no queue, because there is not one', () => {
    // A pass batches within itself and keeps nothing between passes: durability is the un-advanced
    // file offset, which is a byte position rather than a count of anything.
    expect(buildOverlayData(input()).status?.queued).toBe(0);
  });

  it('always sends a status, so "Starting up." means what it says', () => {
    // Every other slice may legitimately be null. This one may not: a null status is the panel's
    // pre-launch state, and sending it later would make the app look like it never finished
    // starting.
    expect(buildOverlayData(input({ dock: null })).status).not.toBeNull();
  });
});
