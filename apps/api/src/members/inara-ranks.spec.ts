import { describe, it, expect } from 'vitest';
import { describeInaraRanks } from '@grims/shared';
import { EMPTY_SNAPSHOT, withInaraRanks, type CommanderSnapshot } from './commander-snapshot.js';

/**
 * Inara's ranks, and what happens where it has none.
 *
 * ★ THE FAILURE THIS GUARDS AGAINST ★
 *
 * Inara only knows commanders who have an Inara account and have published
 * their ranks. Most members do not. If an empty answer from Inara were allowed
 * to win, switching the roster to Inara would have blanked the rank line on the
 * majority of cards — and it would have looked like a display bug, not a
 * sourcing decision, because nothing would have errored.
 */

const JOURNAL: CommanderSnapshot = {
  ...EMPTY_SNAPSHOT,
  ranks: [{ key: 'Combat', label: 'Combat', name: 'Deadly', index: 7 }],
  rankSource: 'journal',
};

const FETCHED = new Date('2026-07-28T12:00:00.000Z');

describe('describeInaraRanks', () => {
  it("maps Inara's vocabulary onto the game's ladders", () => {
    // "exploration" is Inara's word; the journal says "Explore". A lookup
    // written against one silently drops the other — no error, just a rank that
    // stops appearing.
    const out = describeInaraRanks([
      { rankName: 'exploration', rankValue: 8 },
      { rankName: 'combat', rankValue: 0 },
    ]);

    // Order follows what Inara SENT. The function does not sort, and the card
    // sorts by index when it renders — asserting a sort here would pin a
    // guarantee nothing makes.
    expect(out).toEqual([
      { key: 'Explore', label: 'Exploration', name: 'Elite', index: 8 },
      { key: 'Combat', label: 'Combat', name: 'Harmless', index: 0 },
    ]);
  });

  it('keeps rank 0, which is a real rank and not a missing one', () => {
    // Harmless is an achievement level, not an absence. A truthiness check here
    // would delete every new commander's combat rank.
    expect(describeInaraRanks([{ rankName: 'combat', rankValue: 0 }])).toHaveLength(1);
  });

  it('skips ladders we do not show rather than inventing them', () => {
    // Inara sends naval ranks. There is no "Empire" ladder on a roster card, and
    // fabricating one would print a rank that does not exist.
    expect(describeInaraRanks([{ rankName: 'empire', rankValue: 5 }])).toEqual([]);
  });

  it('survives anything that is not the shape we expect', () => {
    expect(describeInaraRanks(null)).toEqual([]);
    expect(describeInaraRanks('nope')).toEqual([]);
    expect(describeInaraRanks([null, 7, { rankName: 'combat' }])).toEqual([]);
  });
});

describe('withInaraRanks', () => {
  it('prefers Inara when it has ranks', () => {
    const out = withInaraRanks(JOURNAL, {
      ranks: [{ key: 'Trade', label: 'Trade', name: 'Elite', index: 8 }],
      fetchedAt: FETCHED,
    });

    expect(out.ranks).toEqual([{ key: 'Trade', label: 'Trade', name: 'Elite', index: 8 }]);
    expect(out.rankSource).toBe('inara');
    expect(out.ranksFetchedAt).toBe(FETCHED.toISOString());
  });

  it('KEEPS THE JOURNAL when Inara returned an empty list', () => {
    // ★ The one that matters. A commander with no Inara account is the common
    // case, and their journal ranks are real data that must not be erased by a
    // source that simply has nothing to say about them.
    const out = withInaraRanks(JOURNAL, { ranks: [], fetchedAt: FETCHED });

    expect(out.ranks).toEqual(JOURNAL.ranks);
    expect(out.rankSource).toBe('journal');
  });

  it('keeps the journal when Inara has no row at all', () => {
    expect(withInaraRanks(JOURNAL, undefined)).toEqual(JOURNAL);
  });

  it('leaves everything else on the snapshot untouched', () => {
    // Ranks are the ONLY thing Inara is allowed to influence. Ship and
    // last-played come from the member's own game and are not Inara's to state.
    const rich: CommanderSnapshot = { ...JOURNAL, currentShip: 'Krait Mk II', squadronRank: 3 };
    const out = withInaraRanks(rich, {
      ranks: [{ key: 'Trade', label: 'Trade', name: 'Elite', index: 8 }],
      fetchedAt: FETCHED,
    });

    expect(out.currentShip).toBe('Krait Mk II');
    expect(out.squadronRank).toBe(3);
  });

  it('reports no source when there are no ranks from anywhere', () => {
    // "journal" on an empty list would claim an authority for nothing.
    expect(withInaraRanks(EMPTY_SNAPSHOT, undefined).rankSource).toBeNull();
  });
});
