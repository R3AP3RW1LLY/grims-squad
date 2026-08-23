import { describe, expect, it } from 'vitest';
import {
  EFFECT_KEYS,
  effectBar,
  summariseSystem,
  unknownSlotsNote,
  type BuildEffects,
  type SummarySite,
} from './colony-system-summary.js';

/**
 * What a whole system adds up to.
 *
 * ★ SQUADRON OWNER, 2026-08-23 ★
 *
 * The seven effects have come down per build type since the catalogue shipped and nothing ever added
 * them up. A member could see what one refinery does and never what their system does.
 *
 * ★ THE SCORE IS OURS AND MUST SAY SO ★
 *
 * Raven publishes a "System Score" and not its formula. Reproducing a number that looked like theirs
 * and disagreed would be worse than showing none, because a member would plan against it.
 */

const fx = (over: Partial<BuildEffects> = {}): BuildEffects => ({
  population: 0,
  maxPopulation: 0,
  security: 0,
  technology: 0,
  wealth: 0,
  standardOfLiving: 0,
  development: 0,
  ...over,
});

const site = (over: Partial<SummarySite> = {}): SummarySite => ({
  effects: fx(),
  totalTonnes: 0,
  built: false,
  ...over,
});

describe('adding a system up', () => {
  it('sums the seven effects across every chosen build', () => {
    const s = summariseSystem([
      site({ effects: fx({ security: 2, wealth: 3.5 }) }),
      site({ effects: fx({ security: 2.3, technology: 9.6 }) }),
    ]);

    expect(s.effects.security).toBe(4.3);
    expect(s.effects.wealth).toBe(3.5);
    expect(s.effects.technology).toBe(9.6);
  });

  it('★ MANDATORY: an unchosen site contributes nothing and is not counted ★', () => {
    /*
     * A plan being filled in is mostly empty rows. Counting them would make `counted` a measure of
     * how much typing somebody has done rather than of what the system will be.
     */
    const s = summariseSystem([
      site({ effects: fx({ wealth: 5 }) }),
      site({ effects: null }),
      site({ effects: null }),
    ]);

    expect(s.counted).toBe(1);
    expect(s.effects.wealth).toBe(5);
  });

  it('★ MANDATORY: a BUILT site still counts toward what the system IS ★', () => {
    /*
     * Built sites are the ones that definitely count — they exist. Excluding them would make a
     * finished system read as having no effects at all.
     */
    const s = summariseSystem([site({ effects: fx({ development: 4 }), built: true })]);

    expect(s.effects.development).toBe(4);
    expect(s.counted).toBe(1);
  });

  it('★ MANDATORY: outstanding tonnage excludes what is already built ★', () => {
    /*
     * The number a member plans hauling around. Including finished sites would overstate the work
     * remaining by everything already delivered — the same rule the build books follow.
     */
    const s = summariseSystem([
      site({ totalTonnes: 6_721, built: true }),
      site({ totalTonnes: 3_000, built: false }),
    ]);

    expect(s.outstandingTonnes).toBe(3_000);
    expect(s.totalTonnes, 'the whole system, built included').toBe(9_721);
  });

  it('does not render floating-point noise', () => {
    // Sums of catalogue decimals produce 14.850000000000001, which reads as precision nobody has.
    const s = summariseSystem([
      site({ effects: fx({ wealth: 4.95 }) }),
      site({ effects: fx({ wealth: 4.95 }) }),
      site({ effects: fx({ wealth: 4.95 }) }),
    ]);

    expect(s.effects.wealth).toBe(14.85);
    expect(String(s.effects.wealth)).not.toContain('0000');
  });

  it('an empty plan is all zeroes, not NaN', () => {
    const s = summariseSystem([]);

    for (const key of EFFECT_KEYS) expect(s.effects[key]).toBe(0);
    expect(s.score).toBe(0);
    expect(s.counted).toBe(0);
  });

  it('the score is the seven effects added together', () => {
    // Explainable in one sentence, and derived entirely from the catalogue.
    const s = summariseSystem([site({ effects: fx({ security: 2, wealth: 3, development: 5 }) })]);
    expect(s.score).toBe(10);
  });
});

describe('drawing a bar for an effect', () => {
  it('★ MANDATORY: scales to the biggest value present, not an invented maximum ★', () => {
    /*
     * There is no published ceiling for any of these scalars. A bar scaled to a number we made up
     * would be a claim about the GAME; scaled to the largest value present it is only a claim about
     * this system, which is all the panel is for.
     */
    const all = fx({ security: 4.3, development: 16.7 });

    expect(effectBar(16.7, all)).toBe(1);
    expect(effectBar(4.3, all)).toBeCloseTo(4.3 / 16.7, 5);
  });

  it('an empty plan draws no bars rather than seven full ones', () => {
    expect(effectBar(0, fx())).toBe(0);
  });

  it('a negative effect draws a bar by its size, never past the end', () => {
    // A nerf is still a magnitude. The caller colours it; this only measures it.
    const all = fx({ security: -8, wealth: 4 });

    expect(effectBar(-8, all)).toBe(1);
    expect(effectBar(4, all)).toBe(0.5);
  });
});

describe('bodies nobody has surveyed', () => {
  it('★ MANDATORY: names how many, because 1 and 32 are different problems ★', () => {
    const note = unknownSlotsNote([
      { bodyId: 1, name: 'A 2' },
      { bodyId: 2, name: 'A 2 a' },
    ]);

    expect(note).toContain('2 bodies');
    expect(note, 'says where the number comes from').toMatch(/architect/i);
  });

  it('gets the singular right', () => {
    expect(unknownSlotsNote([{ bodyId: 1, name: 'A 2' }])).toContain('1 body has');
  });

  it('stays silent when every body is known', () => {
    // A caveat with nothing to caveat is noise on a panel that is already dense.
    expect(unknownSlotsNote([])).toBeNull();
  });
});
