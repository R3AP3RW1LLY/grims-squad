import { describe, it, expect } from 'vitest';
import { accumulate } from './totals.js';
import { EMPTY_TOTALS, loadConfig, DEFAULT_CONFIG } from './config.js';
import { categorySending, eventSending, type CatalogueGroup } from './hub-settings.js';
import type { WatchOutcome } from './watcher.js';

/**
 * The lifetime tally.
 *
 * ★ WHY THIS IS TESTED AT ALL ★
 *
 * A counter that silently stops incrementing looks exactly like an app that has
 * stopped working, and the member has no way to tell the two apart. The panel
 * previously showed the LAST PASS — almost always `0 / 0 / 0`, because the app
 * polls every twenty seconds and the game writes nothing during most of them.
 */

function pass(over: Partial<WatchOutcome> = {}): WatchOutcome {
  return {
    gameRunning: false,
    filesRead: 0,
    newFilesRead: 0,
    sent: 0,
    duplicates: 0,
    refused: {},
    unauthorised: false,
    error: null,
    ...over,
  };
}

const NOW = new Date('2026-07-29T12:00:00Z');

describe('accumulating totals', () => {
  it('MANDATORY: adds up across passes rather than replacing', () => {
    let t = EMPTY_TOTALS;
    t = accumulate(t, pass({ sent: 5, duplicates: 2, newFilesRead: 1 }), NOW);
    t = accumulate(t, pass({ sent: 3, duplicates: 1, newFilesRead: 1 }), NOW);

    expect(t.sent).toBe(8);
    expect(t.duplicates).toBe(3);
    expect(t.journalsRead).toBe(2);
  });

  it('MANDATORY: an idle pass returns the SAME OBJECT, not a copy', () => {
    /*
     * The caller saves the config only when it differs by deep comparison. A
     * fresh-but-equal object would still compare equal, but this also guards
     * the stronger property: nothing about an idle pass may change, or the app
     * would rewrite the config file every twenty seconds forever.
     */
    const t = { sent: 4, duplicates: 1, journalsRead: 2, since: NOW.toISOString() };
    expect(accumulate(t, pass(), NOW)).toBe(t);
  });

  it('MANDATORY: a heartbeat-only pass does not count as activity', () => {
    // gameRunning with no events is the presence heartbeat. It stores nothing,
    // so it must not stamp `since` or dirty the config.
    const t = EMPTY_TOTALS;
    expect(accumulate(t, pass({ gameRunning: true, filesRead: 1 }), NOW)).toBe(t);
  });

  it('MANDATORY: `since` is stamped once and never moved', () => {
    /*
     * Overwriting it each pass would turn "sending since March" into "sending
     * since a moment ago", which is the opposite of what a lifetime total is
     * for.
     */
    const first = accumulate(EMPTY_TOTALS, pass({ sent: 1 }), NOW);
    const later = accumulate(first, pass({ sent: 1 }), new Date('2026-12-25T00:00:00Z'));

    expect(first.since).toBe(NOW.toISOString());
    expect(later.since).toBe(NOW.toISOString());
  });

  it('counts a journal ONCE however many passes read it', () => {
    // A single file is read on many passes as the game appends to it. Counting
    // `filesRead` would report one long session as hundreds of journals.
    let t = EMPTY_TOTALS;
    for (let i = 0; i < 50; i += 1) {
      t = accumulate(t, pass({ sent: 1, filesRead: 1, newFilesRead: i === 0 ? 1 : 0 }), NOW);
    }
    expect(t.journalsRead).toBe(1);
    expect(t.sent).toBe(50);
  });
});

describe('reading totals off disk', () => {
  it('MANDATORY: a config written before totals existed still loads', () => {
    // Every member upgrading has one of these. A throw here would come up as
    // "the app will not start" with nothing to explain it.
    const dir = 'C:/nonexistent-for-this-test';
    expect(loadConfig(dir).totals).toEqual(EMPTY_TOTALS);
    expect(DEFAULT_CONFIG.totals).toEqual(EMPTY_TOTALS);
  });
});

describe('what the hub says is being kept', () => {
  const group = (category: string): CatalogueGroup => ({
    category,
    label: category,
    purpose: '',
    required: category === 'session',
    entries: [],
  });

  const settings = {
    optOutCategories: ['combat'],
    optOutEvents: ['FSDJump'],
    requiredCategory: 'session',
  };

  it('MANDATORY: the required category is on even if an opt-out claims otherwise', () => {
    /*
     * The list arrives over the network. Telling somebody their session data
     * was switched off would be telling them their promotions had stopped
     * counting — false and alarming in one breath.
     */
    expect(categorySending('session', { ...settings, optOutCategories: ['session'] })).toBe(true);
  });

  it('a declined category is off', () => {
    expect(categorySending('combat', settings)).toBe(false);
  });

  it('anything not declined is on — opt-out, not opt-in', () => {
    expect(categorySending('exploration', settings)).toBe(true);
  });

  it('MANDATORY: a declined category takes its events with it', () => {
    // An event inside a switched-off category is off whether or not it was
    // also named individually.
    expect(eventSending(group('combat'), 'Bounty', settings)).toBe(false);
  });

  it('an individually declined event is off inside a live category', () => {
    expect(eventSending(group('exploration'), 'FSDJump', settings)).toBe(false);
    expect(eventSending(group('exploration'), 'Scan', settings)).toBe(true);
  });
});
