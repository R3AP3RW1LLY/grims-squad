import { describe, expect, it } from 'vitest';
import {
  RECENT_KEEP,
  rankSystemChoices,
  recordSystemUse,
  type SystemChoice,
} from './system-picker.js';

/**
 * Choosing a system without typing it again.
 *
 * ★ SQUADRON OWNER, 2026-08-08 ★
 *
 * "when someone is in the freight office or in the where to buy screen ... or any where that asks
 * to enter a system, that it saves entries and keeps them in a dropdown or a bookmark system so
 * that they can just find stuff they have entered quick instead of constantly having to type this
 * information in"
 *
 * Fourteen fields ask for a system across the website and the app — seven each. Every one of them
 * is a free-text box today, and the platform already carries a `CopySystem` button whose entire
 * reason for existing is that retyping these is miserable.
 *
 * ★ WHY THE RANKING IS SHARED AND NOT WRITTEN TWICE ★
 *
 * The same list has to come back in the same order on both surfaces, or a member who pins a system
 * on the website and then opens the app is looking at a different dropdown for the same account.
 * The order is a rule, not a rendering detail, so it lives here with the point arithmetic and the
 * plan economy.
 */

const choice = (over: Partial<SystemChoice> & { name: string }): SystemChoice => ({
  source: 'recent',
  lastUsedAt: 0,
  useCount: 1,
  label: null,
  systemId64: null,
  ...over,
});

describe('ranking what to offer in a system box', () => {
  it('puts pinned systems above recents, and recents above the galaxy', () => {
    const out = rankSystemChoices('', [
      choice({ name: 'Deciat', source: 'galaxy' }),
      choice({ name: 'Shinrarta Dezhra', source: 'recent', lastUsedAt: 500 }),
      choice({ name: 'Sol', source: 'pinned' }),
    ]);

    expect(out.map((c) => c.name)).toEqual(['Sol', 'Shinrarta Dezhra', 'Deciat']);
  });

  it('offers where the member is standing before anything they have pinned', () => {
    /*
     * The single most likely answer to "which system" is the one the commander is sitting in, and
     * the app knows it. Ranking it under a pin would make the useful case the second click.
     */
    const out = rankSystemChoices('', [
      choice({ name: 'Sol', source: 'pinned' }),
      choice({ name: 'Col 285 Sector GL-W c2-12', source: 'here' }),
    ]);

    expect(out[0]?.name).toBe('Col 285 Sector GL-W c2-12');
  });

  it('prefers a prefix match over a match buried in the middle', () => {
    const out = rankSystemChoices('col', [
      choice({ name: 'Nicol', source: 'galaxy' }),
      choice({ name: 'Col 285 Sector GL-W c2-12', source: 'galaxy' }),
    ]);

    expect(out[0]?.name).toBe('Col 285 Sector GL-W c2-12');
  });

  it('ignores case and stray spacing, because members paste from the game', () => {
    const out = rankSystemChoices('  COL 285 sector gl-w  ', [
      choice({ name: 'Col 285 Sector GL-W c2-12', source: 'galaxy' }),
      choice({ name: 'Deciat', source: 'galaxy' }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('Col 285 Sector GL-W c2-12');
  });

  it('matches on a custom label as well as the real name', () => {
    // A member who pinned c2-12 as "home" should find it by typing home.
    const out = rankSystemChoices('home', [
      choice({ name: 'Col 285 Sector GL-W c2-12', source: 'pinned', label: 'Home' }),
      choice({ name: 'Deciat', source: 'galaxy' }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('Col 285 Sector GL-W c2-12');
  });

  it('breaks a tie on recency, then on how often it has been used', () => {
    const out = rankSystemChoices('', [
      choice({ name: 'Older but popular', lastUsedAt: 100, useCount: 40 }),
      choice({ name: 'Just used', lastUsedAt: 900, useCount: 1 }),
    ]);

    expect(out.map((c) => c.name)).toEqual(['Just used', 'Older but popular']);
  });

  it('never offers the same system twice, whatever it arrived as', () => {
    /*
     * The same system legitimately arrives from several sources at once — pinned, recently used,
     * and in the galaxy table. A dropdown showing Sol three times reads as broken.
     */
    const out = rankSystemChoices('sol', [
      choice({ name: 'Sol', source: 'galaxy' }),
      choice({ name: 'Sol', source: 'pinned' }),
      choice({ name: 'sol', source: 'recent', lastUsedAt: 10 }),
    ]);

    expect(out).toHaveLength(1);
    // And it keeps the STRONGEST source, so the pin badge is not lost to a galaxy row.
    expect(out[0]?.source).toBe('pinned');
  });

  it('returns nothing rather than everything when nothing matches', () => {
    const out = rankSystemChoices('zzzzz', [choice({ name: 'Sol', source: 'galaxy' })]);
    expect(out).toEqual([]);
  });
});

describe('remembering what was used', () => {
  it('moves a repeat use to the front and counts it', () => {
    const before: SystemChoice[] = [
      choice({ name: 'Deciat', lastUsedAt: 200, useCount: 3 }),
      choice({ name: 'Sol', lastUsedAt: 100, useCount: 1 }),
    ];

    const after = recordSystemUse(before, 'Sol', 300);

    expect(after[0]?.name).toBe('Sol');
    expect(after[0]?.useCount).toBe(2);
    expect(after[0]?.lastUsedAt).toBe(300);
  });

  it('treats a differently-cased repeat as the same system', () => {
    const after = recordSystemUse([choice({ name: 'Sol', lastUsedAt: 100, useCount: 1 })], 'SOL', 300);

    expect(after).toHaveLength(1);
    expect(after[0]?.useCount).toBe(2);
    // The stored spelling is left alone: the first one came from the galaxy and is the right one.
    expect(after[0]?.name).toBe('Sol');
  });

  it(`keeps only the ${RECENT_KEEP} most recent, so the list stays a shortcut`, () => {
    let list: readonly SystemChoice[] = [];
    for (let i = 0; i < RECENT_KEEP + 8; i++) list = recordSystemUse(list, `System ${i}`, i);

    expect(list).toHaveLength(RECENT_KEEP);
    // The oldest fell off the end, not the newest.
    expect(list[0]?.name).toBe(`System ${RECENT_KEEP + 7}`);
    expect(list.some((c) => c.name === 'System 0')).toBe(false);
  });

  it('never drops a pin to make room for a recent', () => {
    /*
     * A pin is a deliberate act and a recent is a side effect. Trimming the list by age alone
     * would quietly delete the thing the member asked us to keep.
     */
    let list: readonly SystemChoice[] = [choice({ name: 'Home', source: 'pinned', lastUsedAt: 0 })];
    for (let i = 0; i < RECENT_KEEP + 5; i++) list = recordSystemUse(list, `System ${i}`, i + 1);

    expect(list.some((c) => c.name === 'Home')).toBe(true);
  });
});
