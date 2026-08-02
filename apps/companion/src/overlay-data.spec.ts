import { describe, expect, it } from 'vitest';
import { buildOverlayData, type OverlayInput } from './overlay-data.js';
import type { DockedAt } from './docked.js';

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
    now: NOW,
    ...overrides,
  };
}

describe('the overlay payload', () => {
  it('reports what the site still needs, and drops what is finished', () => {
    const { build } = buildOverlayData(input());

    expect(build?.needs).toEqual([
      { commodity: 'Steel', remaining: 20_064, required: 60_984 },
      { commodity: 'Aluminium', remaining: 25_756, required: 42_282 },
    ]);
    // Titanium is done. A completed line is a row of noise on a panel over a cockpit.
    expect(build?.needs.map((n) => n.commodity)).not.toContain('Titanium');
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

  /* ------------------------------------------------------------ honest nulls */

  it('sends no cargo at all rather than an empty hold', () => {
    const { cargo } = buildOverlayData(input());

    /*
     * ★ THE ONE THAT MATTERS ★
     *
     * The panel reads `items: []` as "Hold empty." and `null` as "Waiting for your hold." Only the
     * second is true today — nothing in the app reads Cargo.json — and telling a member with a full
     * hold that it is empty is the kind of wrong that makes somebody stop trusting the whole app.
     */
    expect(cargo).toBeNull();
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
