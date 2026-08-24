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

  it('★ MANDATORY: docking at ANOTHER construction site shows THAT site ★', () => {
    /*
     * ★ THIS TEST USED TO ASSERT THE OPPOSITE — SQUADRON OWNER, 2026-08-23 ★
     *
     * It read "keeps the hub view when docked at some OTHER construction site", reasoning that "a
     * member restocking at a different depot is still on the business of THEIR build".
     *
     * Asked directly which should win when the dock and the chosen primary disagree, the owner's
     * answer was the dock — and the old reasoning had the case wrong. You do not restock at a
     * construction site; there is nothing to buy there. A member parked on a construction pad is
     * about to hand cargo over to THAT site, and describing a different project while somebody is
     * transferring to this one is wrong exactly when it matters most.
     */
    const elsewhere = dockedAt({ marketId: '999999' } as Partial<DockedAt>);
    const { build } = buildOverlayData(input({ dock: elsewhere, currentProject: currentBuild() }));

    expect(build?.fromHub, 'the pad in front of them, not the hub').toBe(false);
    expect(build?.delivered).toBe(92_006);
  });

  it('★ MANDATORY: it does NOT borrow the primary project’s name for somebody else’s site ★', () => {
    /*
     * The hub has told us nothing about a site the member merely flew to. Labelling that pad with
     * the current build's title would be the exact confusion this change exists to remove — and it
     * would look authoritative, because the title bar is where members read the project name.
     */
    const elsewhere = dockedAt({ marketId: '999999' } as Partial<DockedAt>);
    const { build } = buildOverlayData(input({ dock: elsewhere, currentProject: currentBuild() }));

    // Read off the docked station's own name, not the hub's project.
    expect(build?.title).toBe('Harry’s Dysfunctional Society');
    expect(build?.haulers, 'and no crew count we did not measure').toBe(0);
  });

  it('★ MANDATORY: a diversion says so, so it does not read as a lost setting ★', () => {
    const elsewhere = dockedAt({ marketId: '999999' } as Partial<DockedAt>);
    const diverted = buildOverlayData(input({ dock: elsewhere, currentProject: currentBuild() }));
    expect(diverted.build?.because).toMatch(/not your primary/i);

    /*
     * And stays quiet when there is nothing to explain — a strip over a cockpit cannot afford a row
     * telling somebody they are docked where they are docked.
     */
    const atOwn = buildOverlayData(input({ currentProject: currentBuild() }));
    expect(atOwn.build?.because).toBeUndefined();
  });

  it('an ordinary station does NOT divert the panel', () => {
    /*
     * The half of the old reasoning that survives, and the reason `site` rather than `dock` is the
     * test. A market, a carrier, anywhere cargo is actually bought has no depot heartbeat — so the
     * member is still working their chosen build and the panel keeps showing it.
     */
    const market = dockedAt({ marketId: '999999', site: null } as Partial<DockedAt>);
    const { build } = buildOverlayData(input({ dock: market, currentProject: currentBuild() }));

    expect(build?.fromHub).toBe(true);
    expect(build?.delivered).toBe(100_000);
    expect(build?.because, 'and nothing to explain').toBeUndefined();
  });

  it('falls back to the journal-docked view when no current build is set', () => {
    // The behaviour the panel has always had, untouched — including for unposted sites.
    const { build } = buildOverlayData(input({ currentProject: null }));
    expect(build?.fromHub).toBe(false);
    expect(build?.delivered).toBe(92_006);
  });

  /* ---------------------------------------------- everything owed, across builds */

  /**
   * ★ SQUADRON OWNER, 2026-08-23 ★
   *
   * "SrvSurvey will then show cargo items needed only for the primary or all projects."
   *
   * Merged by the hub with the shared rule — see `colony-all-needs.spec.ts`. What is tested here is
   * only WHEN the panel carries it, which is the part this module decides.
   */
  const owed = (projects = 2) => ({
    rows: [
      {
        commodity: 'Steel',
        tonnes: 800,
        category: 'Metals',
        shared: projects > 1,
        wantedBy: [
          { projectId: 'p-1', title: 'One', tonnes: 500 },
          ...(projects > 1 ? [{ projectId: 'p-2', title: 'Two', tonnes: 300 }] : []),
        ],
      },
    ],
    projects,
    totalTonnes: 800,
  });

  it('★ MANDATORY: stays quiet when the member is on a single build ★', () => {
    /*
     * There it is the SAME list printed twice, under a heading implying it is something else — and
     * on a strip over a cockpit every wasted row costs one somebody needed.
     */
    const { build } = buildOverlayData(input({ currentProject: currentBuild(), owed: owed(1) }));

    expect(build?.allProjects).toBeUndefined();
  });

  it('carries the combined list on both the docked and the hub path', () => {
    // A member owes what they owe wherever the panel happens to be focused.
    const docked = buildOverlayData(input({ currentProject: currentBuild(), owed: owed() }));
    expect(docked.build?.allProjects?.projects).toBe(2);

    const away = dockedAt({ marketId: '999999', site: null } as Partial<DockedAt>);
    const hub = buildOverlayData(input({ dock: away, currentProject: currentBuild(), owed: owed() }));
    expect(hub.build?.allProjects?.projects).toBe(2);
  });

  it('★ MANDATORY: still draws with NOTHING focused — the market case ★', () => {
    /*
     * ★ THIS RETURNED null AND LOST THE FEATURE WHERE IT MATTERS MOST ★
     *
     * No primary set and not docked at a site is exactly the state of somebody standing in a
     * commodity market with an empty hold — which is the one place a combined shopping list is the
     * whole point. The panel had nothing to draw and drew nothing.
     */
    const away = dockedAt({ marketId: '999999', site: null } as Partial<DockedAt>);
    const { build } = buildOverlayData(input({ dock: away, currentProject: null, owed: owed() }));

    expect(build, 'the panel exists').not.toBeNull();
    expect(build?.allProjects?.rows[0]?.commodity).toBe('Steel');
    // And claims nothing about a focused build, because there is not one.
    expect(build?.needs).toEqual([]);
    expect(build?.required, 'a zero requirement hides the progress bar rather than showing 0%').toBe(0);
    expect(build?.title).toBeNull();
  });

  it('draws nothing at all when there is neither a build nor anything owed', () => {
    const away = dockedAt({ marketId: '999999', site: null } as Partial<DockedAt>);
    expect(buildOverlayData(input({ dock: away, currentProject: null })).build).toBeNull();
  });

  it('★ MANDATORY: absent, not empty, until the hub has answered ★', () => {
    /*
     * Null from the hub means "we have not asked yet" and must not render as "you owe nothing
     * anywhere" — the same distinction this module keeps for the hold and the standing orders.
     */
    const { build } = buildOverlayData(input({ currentProject: currentBuild(), owed: null }));

    expect(build?.allProjects).toBeUndefined();
  });

  it('keeps the split, so a hold is not filled for the wrong site', () => {
    /*
     * 800 t across two builds is 800 t to BUY and not 800 t to hand to either of them. Without the
     * breakdown a member fills a hold for one site and finds half of it unwanted on arrival.
     */
    const { build } = buildOverlayData(input({ currentProject: currentBuild(), owed: owed() }));

    expect(build?.allProjects?.rows[0]?.wantedBy).toEqual([
      { title: 'One', tonnes: 500 },
      { title: 'Two', tonnes: 300 },
    ]);
    expect(build?.allProjects?.rows[0]?.shared).toBe(true);
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

describe('the build panel says how old its numbers are', () => {
  /**
   * ★ "LIVE FROM THE SQUADRON" WAS SAID UNCONDITIONALLY — AUDIT, 2026-08-18 ★
   *
   * The footer claimed it whatever the age of the reading, so a needs list from a site nobody had
   * docked at in a fortnight was captioned identically to one read four minutes ago. A member
   * hauling against the stale one had no way to tell, and the caption actively said it was fine.
   *
   * The hub has always sent `observedAt` on every need, and `DockedAt.at` has always carried "the
   * journal's own timestamp, so the UI can say how fresh this is". Both existed. Neither was read.
   */

  it('★ MANDATORY: carries the NEWEST reading, not the oldest ★', () => {
    /*
     * One commodity refreshed today makes the whole list that current — the same rule the website's
     * needs table uses. Taking the oldest would understate a list somebody had just updated and
     * would have members distrusting figures that were right.
     */
    const { build } = buildOverlayData(
      input({
        dock: null,
        currentProject: currentBuild({
          needs: [
            { commodity: 'Steel', remaining: 100, required: 100, observedAt: '2026-08-01T00:00:00.000Z' },
            { commodity: 'Copper', remaining: 50, required: 50, observedAt: '2026-08-18T00:00:00.000Z' },
          ],
        }),
      }),
    );

    expect(build?.observedAt).toBe('2026-08-18T00:00:00.000Z');
  });

  it('★ MANDATORY: never observed is null, not "very old" ★', () => {
    /*
     * A build nobody has docked at yet has no reading at all — its figures are the catalogue's
     * estimate. Reporting that as stale would be alarming and wrong, which is the same distinction
     * `needsFreshness` draws for the website.
     */
    const { build } = buildOverlayData(
      input({
        dock: null,
        currentProject: currentBuild({
          needs: [{ commodity: 'Steel', remaining: 100, required: 100, observedAt: null }],
        }),
      }),
    );

    expect(build?.observedAt).toBeNull();
  });
});
