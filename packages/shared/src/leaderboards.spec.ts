import { describe, expect, it } from 'vitest';
import {
  LEADERBOARD_BADGES,
  LEADERBOARDS,
  TIER_LADDERS,
  badgeByKey,
  badgeDisplay,
  showcase,
  tiersEarned,
} from './leaderboards.js';
import { BADGES as FORUM_BADGES } from './reputation.js';

describe('the badge catalogue', () => {
  it('MANDATORY: every badge key is unique — member_badges rows resolve by key alone', () => {
    const keys = LEADERBOARD_BADGES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every badge belongs to a board that exists', () => {
    const boards = new Set(LEADERBOARDS.map((l) => l.key));
    for (const b of LEADERBOARD_BADGES) expect(boards.has(b.board)).toBe(true);
  });

  it('every board carries a full four-rung ladder with themed names', () => {
    for (const l of LEADERBOARDS) {
      const tiers = LEADERBOARD_BADGES.filter((b) => b.board === l.key && b.kind === 'tier');
      expect(tiers).toHaveLength(TIER_LADDERS[l.key].length);
      // "bronze, silver, gold are very boring! and we cant identify them if someone has the same
      // rank across several leaderboards" — no rank NAME repeats anywhere, ever.
      for (const t of tiers) expect(t.name).not.toMatch(/bronze|silver|gold|platinum/i);
    }
    const names = LEADERBOARD_BADGES.filter((b) => b.kind === 'tier').map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every ladder ascends — a member can never earn Magnate before Merchant', () => {
    for (const l of LEADERBOARDS) {
      const ladder = TIER_LADDERS[l.key];
      for (let i = 1; i < ladder.length; i += 1) {
        expect(ladder[i]!.at).toBeGreaterThan(ladder[i - 1]!.at);
      }
    }
  });

  it('tiersEarned pays exactly the rungs crossed, per board ladder', () => {
    expect(tiersEarned('colony', 0)).toHaveLength(0);
    expect(tiersEarned('colony', 1_000).map((b) => b.key)).toEqual(['colony-bronze']);
    expect(tiersEarned('colony', 199_999)).toHaveLength(3);
    expect(tiersEarned('colony', 200_000)).toHaveLength(4);
    // The first live run proved the boards price points differently: 282k is the TOP colony rung
    // and only the THIRD trade rung.
    expect(tiersEarned('trade', 282_586).map((b) => b.key)).toEqual([
      'trade-bronze',
      'trade-silver',
      'trade-gold',
    ]);
  });

  it('badgeByKey answers for real keys and null for junk', () => {
    expect(badgeByKey('trade-millionaire-run')?.icon).toBe('💰');
    expect(badgeByKey('not-a-badge')).toBeNull();
  });
});

describe('the forum showcase', () => {
  it('shows the highest tier per board, rarest first, within the cap', () => {
    const shown = showcase(
      ['bounties-bronze', 'bounties-gold', 'colony-silver', 'trade-first-profit'],
      3,
    );
    expect(shown.map((b) => b.key)).toEqual([
      'bounties-gold', // Beacon Keeper at 25k outranks Foreman at 10k
      'colony-silver',
      'trade-first-profit',
    ]);
  });

  it('champions outrank ordinary achievements when space is short', () => {
    const shown = showcase(['trade-first-profit', 'colony-season-champion'], 1);
    expect(shown.map((b) => b.key)).toEqual(['colony-season-champion']);
  });

  it('unknown keys are skipped rather than crashing the post they decorate', () => {
    expect(showcase(['retired-badge-from-2027', 'colony-bronze'], 4)).toHaveLength(1);
  });
});

describe('the two catalogues stay two catalogues', () => {
  it('MANDATORY: no leaderboard key collides with a forum badge key', () => {
    const forum = new Set(FORUM_BADGES.map((b) => b.key));
    for (const b of LEADERBOARD_BADGES) expect(forum.has(b.key)).toBe(false);
  });

  it('badgeDisplay resolves keys from BOTH catalogues, with a face each', () => {
    expect(badgeDisplay('colony-line-closer')?.icon).toBe('✅');
    const forum = badgeDisplay('navigator');
    expect(forum?.name).toBe('Navigator');
    expect(forum?.icon).not.toBe('');
    expect(badgeDisplay('never-existed')).toBeNull();
  });

  it('the forum catalogue is still itself — the shadowing regression stays dead', () => {
    // For a few hours an explicit BADGES export shadowed the star-exported forum catalogue and
    // the reputation sweep quietly read leaderboard keys. This pins the two apart for ever.
    expect(FORUM_BADGES.some((b) => b.key === 'first-answer')).toBe(true);
    expect(FORUM_BADGES.some((b) => b.key.startsWith('bounties-'))).toBe(false);
  });
});
