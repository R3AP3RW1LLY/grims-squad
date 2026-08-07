import { describe, expect, it } from 'vitest';
import { foldRefining, EMPTY_REFINING, refinedRate, sessionMinutes } from './refinery.js';

/**
 * What the refinery has finished this session, and what it is worth on the board.
 *
 * ★ SCORED ON REFINING, NOT ON SELLING ★
 *
 * `MiningRefined` fires when the refinery completes a tonne — the moment the work happened. Selling
 * is a different skill with its own board, and paying twice for one tonne would let a miner farm
 * both with a single action.
 *
 * ★ THE POINTS SHOWN HERE ARE THE POINTS THAT LAND ★
 *
 * Computed with the same `miningPoints` the hub scores with, from the same shared weights. A panel
 * that estimated its own number would eventually disagree with the leaderboard, and the member
 * watching it would be right to trust the panel and wrong about their score.
 */

const T0 = Date.parse('2026-08-06T20:00:00Z');

/** One refined tonne, as the journal reports it after the field allowlist. */
const refined = (name: string) => ({ Type_Localised: name });

describe('counting what the refinery finished', () => {
  it('MANDATORY: a tonne is one tonne', () => {
    /*
     * `MiningRefined` carries no quantity — it fires once per completed tonne. Reading a count off
     * it would be inventing one.
     */
    const state = foldRefining(EMPTY_REFINING, refined('Painite'), T0);

    expect(state.tonnes).toBe(1);
    expect(state.byMaterial['Painite']).toBe(1);
  });

  it('MANDATORY: tonnes accumulate per material', () => {
    let state = EMPTY_REFINING;
    for (const m of ['Painite', 'Painite', 'Platinum', 'Painite']) {
      state = foldRefining(state, refined(m), T0);
    }

    expect(state.tonnes).toBe(4);
    expect(state.byMaterial['Painite']).toBe(3);
    expect(state.byMaterial['Platinum']).toBe(1);
  });

  it('MANDATORY: points use the shared weights, so the panel agrees with the board', () => {
    /*
     * Painite is ×4, Void Opal ×8. If this drifted from the hub's scoring the member would watch a
     * number all evening and then be credited a different one.
     */
    let state = foldRefining(EMPTY_REFINING, refined('Painite'), T0);
    expect(state.points).toBe(4);

    state = foldRefining(state, refined('Void Opal'), T0);
    expect(state.points).toBe(12);
  });

  it('MANDATORY: an unknown mineral still scores at the floor', () => {
    // Frontier adds commodities. Scoring nothing would make a miner's night vanish silently.
    const state = foldRefining(EMPTY_REFINING, refined('Some Future Mineral'), T0);

    expect(state.points).toBe(1);
    expect(state.tonnes).toBe(1);
  });

  it('MANDATORY: the internal symbol is used when there is no display name', () => {
    /*
     * Frontier ships some commodities with no `Type_Localised`. Dropping those would lose whole
     * materials from the session with no pattern the member could see.
     */
    const state = foldRefining(EMPTY_REFINING, { Type: 'painite' }, T0);

    expect(state.tonnes).toBe(1);
    expect(Object.keys(state.byMaterial)).toHaveLength(1);
  });

  it('MANDATORY: an event with no material at all is ignored, not counted as a blank', () => {
    /*
     * A blank key would put an unnamed bar on the panel and add tonnes nobody mined. Ignoring it
     * loses nothing: an event that does not say what was refined cannot be scored anyway.
     */
    const state = foldRefining(EMPTY_REFINING, {}, T0);

    expect(state.tonnes).toBe(0);
    expect(Object.keys(state.byMaterial)).toHaveLength(0);
  });
});

describe('the session clock', () => {
  it('MANDATORY: starts at the first tonne, not when the app opened', () => {
    /*
     * An app left running since breakfast would otherwise divide an evening's tonnage by nine
     * hours and report a rate a tenth of the truth.
     */
    const state = foldRefining(EMPTY_REFINING, refined('Painite'), T0);

    expect(state.startedAt).toBe(T0);
  });

  it('MANDATORY: the rate is tonnes per hour of ACTUAL mining', () => {
    let state = foldRefining(EMPTY_REFINING, refined('Painite'), T0);
    // Thirty tonnes over the following hour.
    for (let i = 1; i < 30; i += 1) {
      state = foldRefining(state, refined('Painite'), T0 + i * 120_000);
    }

    // 30 tonnes across 58 minutes of elapsed session.
    expect(refinedRate(state, T0 + 3_480_000)).toBeGreaterThan(28);
    expect(refinedRate(state, T0 + 3_480_000)).toBeLessThan(32);
  });

  it('MANDATORY: no rate before any tonne, rather than zero', () => {
    /*
     * "0 t/h" reads as "you are mining badly". Null reads as "nothing yet", which is the truth and
     * the panel can render it as a dash.
     */
    expect(refinedRate(EMPTY_REFINING, T0)).toBeNull();
  });

  it('MANDATORY: a rate is never divided by zero elapsed time', () => {
    /*
     * The first tonne arrives at exactly `startedAt`. Dividing by zero minutes gives Infinity,
     * which renders as "Infinity t/h" on a panel somebody is reading at a glance.
     */
    const state = foldRefining(EMPTY_REFINING, refined('Painite'), T0);
    const rate = refinedRate(state, T0);

    expect(Number.isFinite(rate ?? 0), 'the rate went infinite on the first tonne').toBe(true);
  });

  it('reports elapsed minutes for the panel', () => {
    const state = foldRefining(EMPTY_REFINING, refined('Painite'), T0);

    expect(sessionMinutes(state, T0 + 3_600_000)).toBe(60);
    expect(sessionMinutes(EMPTY_REFINING, T0)).toBeNull();
  });
});
