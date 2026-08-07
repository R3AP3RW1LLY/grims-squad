import { describe, expect, it } from 'vitest';
import { readRock, foldProspecting, EMPTY_PROSPECTING } from './prospector.js';

/**
 * Reading a prospected rock, and keeping score across a session.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... must meet / exceed ED tools as it works currently!"
 *
 * ★ THE TWO-SECOND DECISION ★
 *
 * A prospected rock drifts past in a couple of seconds and the whole skill of laser mining is
 * deciding, inside that window, whether it is worth the time. Everything here exists to make that
 * decision instantly readable: the best material first, its share, and whether it beats the bar the
 * member set for that specific material.
 *
 * Pure, and separate from the overlay that draws it, so every case below can be tested without
 * launching Electron and flying to a ring.
 */

/** A rock as Frontier writes it, after the field allowlist has kept what we asked for. */
const ROCK = {
  Materials: [
    { Name: 'Bertrandite', Proportion: 4.2 },
    { Name: 'Painite', Proportion: 38.4 },
    { Name: 'Bauxite', Proportion: 12.9 },
  ],
  Content_Localised: 'High',
  Remaining: 100,
};

describe('reading one rock', () => {
  it('MANDATORY: the best material comes first, whatever order the game listed them', () => {
    /*
     * Frontier does not sort them. A panel that showed the journal's order would put 4% Bertrandite
     * at the top of a rock carrying 38% Painite — the exact opposite of the decision being made.
     */
    const rock = readRock(ROCK);

    expect(rock?.materials[0]?.name).toBe('Painite');
    expect(rock?.materials[0]?.percent).toBeCloseTo(38.4);
    expect(rock?.top?.name).toBe('Painite');
  });

  it('MANDATORY: every material is kept, not just the best', () => {
    // A rock with three usable minerals is a different rock from one with a single spike, and a
    // core miner reads the whole list before deciding whether to spend a charge.
    expect(readRock(ROCK)?.materials).toHaveLength(3);
  });

  it('MANDATORY: a motherlode is named', () => {
    /*
     * The rock a core miner is hunting. It changes what you do next more than any percentage does,
     * which is why it is a field of its own rather than something inferred from a number.
     */
    const rock = readRock({ ...ROCK, MotherlodeMaterial: 'Platinum' });

    expect(rock?.motherlode).toBe('Platinum');
  });

  it('MANDATORY: the localised motherlode name wins over the symbol', () => {
    const rock = readRock({
      ...ROCK,
      MotherlodeMaterial: '$platinum_name;',
      MotherlodeMaterial_Localised: 'Platinum',
    });

    expect(rock?.motherlode).toBe('Platinum');
  });

  it('MANDATORY: a rock with no materials is not a rock', () => {
    /*
     * Returned as null rather than an empty panel. A prospector that fires on a barren rock has
     * told the member something — but an overlay drawing an empty list looks broken, and the panel
     * should simply keep showing the last real rock.
     */
    expect(readRock({ Materials: [] })).toBeNull();
    expect(readRock({})).toBeNull();
    expect(readRock(null)).toBeNull();
  });

  it('MANDATORY: a malformed proportion cannot become NaN on screen', () => {
    // Straight from the wire. A NaN percentage renders as "NaN%" and sorts unpredictably, so it is
    // dropped rather than shown.
    const rock = readRock({
      Materials: [
        { Name: 'Painite', Proportion: 'lots' },
        { Name: 'Platinum', Proportion: 22.5 },
      ],
    });

    expect(rock?.materials).toHaveLength(1);
    expect(rock?.top?.name).toBe('Platinum');
  });

  it('keeps how much of the rock is left', () => {
    // A rock already half-mined by somebody else reads very differently from a fresh one.
    expect(readRock({ ...ROCK, Remaining: 42 })?.remaining).toBe(42);
  });

  it('carries the content grade the game reports', () => {
    expect(readRock(ROCK)?.content).toBe('High');
  });
});

describe('keeping score across a session', () => {
  const thresholds = { default: 20, perMaterial: {} };

  it('MANDATORY: counts every rock and the ones worth shooting', () => {
    /*
     * Hit rate is how a miner knows whether the ring is worth staying in, and it is the number no
     * in-game screen shows.
     */
    let state = EMPTY_PROSPECTING;
    state = foldProspecting(state, readRock(ROCK), thresholds); // 38.4% — a hit
    state = foldProspecting(state, readRock({ Materials: [{ Name: 'Bauxite', Proportion: 3 }] }), thresholds);
    state = foldProspecting(state, readRock({ Materials: [{ Name: 'Painite', Proportion: 25 }] }), thresholds);

    expect(state.prospected).toBe(3);
    expect(state.hits).toBe(2);
  });

  it('MANDATORY: a barren rock still counts as prospected', () => {
    /*
     * It cost a limpet and it is evidence about the ring. Counting only the good ones would make
     * the hit rate meaningless — it would always be 100%.
     */
    const state = foldProspecting(EMPTY_PROSPECTING, null, thresholds);

    expect(state.prospected).toBe(1);
    expect(state.hits).toBe(0);
  });

  it('MANDATORY: the current rock is the one just read', () => {
    const state = foldProspecting(EMPTY_PROSPECTING, readRock(ROCK), thresholds);

    expect(state.current?.top?.name).toBe('Painite');
    expect(state.currentIsHit).toBe(true);
  });

  it('MANDATORY: a barren rock does NOT clear the last good one', () => {
    /*
     * The panel would flicker to empty on every miss, which in a poor ring is most of them. The
     * last rock worth looking at stays up; only the counters move.
     */
    let state = foldProspecting(EMPTY_PROSPECTING, readRock(ROCK), thresholds);
    state = foldProspecting(state, null, thresholds);

    expect(state.current?.top?.name, 'the panel went blank on a barren rock').toBe('Painite');
    expect(state.currentIsHit, 'a barren rock is not a hit, even keeping the old display').toBe(false);
  });

  it('MANDATORY: the best rock of the session is remembered', () => {
    let state = EMPTY_PROSPECTING;
    state = foldProspecting(state, readRock({ Materials: [{ Name: 'Painite', Proportion: 25 }] }), thresholds);
    state = foldProspecting(state, readRock({ Materials: [{ Name: 'Painite', Proportion: 44 }] }), thresholds);
    state = foldProspecting(state, readRock({ Materials: [{ Name: 'Painite', Proportion: 31 }] }), thresholds);

    expect(state.bestPercent).toBeCloseTo(44);
    expect(state.bestMaterial).toBe('Painite');
  });

  it('MANDATORY: motherlodes are counted separately', () => {
    // Rare enough that a session total is worth showing on its own.
    let state = EMPTY_PROSPECTING;
    state = foldProspecting(state, readRock({ ...ROCK, MotherlodeMaterial: 'Platinum' }), thresholds);
    state = foldProspecting(state, readRock(ROCK), thresholds);

    expect(state.motherlodes).toBe(1);
  });

  it('MANDATORY: per-material thresholds decide what counts as a hit', () => {
    /*
     * The setting the squadron owner asked for, doing its job: 12% Painite is a good rock and 12%
     * Bauxite is not worth the limpet, and one global number cannot express that.
     */
    const perMaterial = { default: 30, perMaterial: { Painite: 10 } };

    let state = foldProspecting(EMPTY_PROSPECTING, readRock({ Materials: [{ Name: 'Painite', Proportion: 12 }] }), perMaterial);
    expect(state.hits).toBe(1);

    state = foldProspecting(state, readRock({ Materials: [{ Name: 'Bauxite', Proportion: 12 }] }), perMaterial);
    expect(state.hits, 'the default should still have applied to Bauxite').toBe(1);
  });
});
