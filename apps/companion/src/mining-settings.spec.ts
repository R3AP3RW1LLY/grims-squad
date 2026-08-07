import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINING_SETTINGS,
  readMiningSettings,
  setDefaultThreshold,
  setMaterialThreshold,
  clearMaterialThreshold,
} from './mining-settings.js';

/**
 * The percentages a member chooses, and what happens to nonsense.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add full on mining companion app settings to allow the user the option to select percentages"
 *
 * ★ WHY VALIDATION IS THE WHOLE FILE ★
 *
 * These numbers come off a text box and are then compared against a percentage from the game on
 * every rock. A NaN slipping through does not throw — it makes `percent >= NaN` false for ever, so
 * the overlay silently stops highlighting anything and the member has no way to tell whether the
 * ring is poor or the setting is broken.
 *
 * So every entry point clamps and rejects, and a stored file that has been hand-edited or written
 * by an older version is repaired on read rather than trusted.
 */

describe('what a member starts with', () => {
  it('MANDATORY: a sane default and no per-material overrides', () => {
    expect(DEFAULT_MINING_SETTINGS.default).toBeGreaterThan(0);
    expect(DEFAULT_MINING_SETTINGS.default).toBeLessThan(100);
    expect(Object.keys(DEFAULT_MINING_SETTINGS.perMaterial)).toHaveLength(0);
  });
});

describe('reading what was saved', () => {
  it('MANDATORY: nothing saved gives the defaults, not a crash', () => {
    expect(readMiningSettings(null)).toEqual(DEFAULT_MINING_SETTINGS);
    expect(readMiningSettings(undefined)).toEqual(DEFAULT_MINING_SETTINGS);
    expect(readMiningSettings('not json at all')).toEqual(DEFAULT_MINING_SETTINGS);
  });

  it('MANDATORY: a good file round-trips', () => {
    const saved = readMiningSettings(JSON.stringify({ default: 25, perMaterial: { Painite: 10 } }));

    expect(saved.default).toBe(25);
    expect(saved.perMaterial['Painite']).toBe(10);
  });

  it('MANDATORY: a NaN threshold is repaired, never kept', () => {
    /*
     * The bug this file exists to prevent. `percent >= NaN` is false for every rock, so the overlay
     * would stop highlighting anything at all — and the member would blame the ring.
     */
    const repaired = readMiningSettings(JSON.stringify({ default: 'lots', perMaterial: { Painite: null } }));

    expect(repaired.default).toBe(DEFAULT_MINING_SETTINGS.default);
    expect(repaired.perMaterial['Painite'], 'a non-numeric override survived').toBeUndefined();
  });

  it('MANDATORY: out-of-range numbers are clamped, not discarded', () => {
    /*
     * Clamped rather than dropped: somebody who typed 150 meant "only the very best", and silently
     * reverting them to the default would be a setting that visibly refuses to save.
     */
    const clamped = readMiningSettings(
      JSON.stringify({ default: 150, perMaterial: { Painite: -20, Platinum: 250 } }),
    );

    expect(clamped.default).toBe(100);
    expect(clamped.perMaterial['Painite']).toBe(0);
    expect(clamped.perMaterial['Platinum']).toBe(100);
  });

  it('MANDATORY: zero is preserved, because it means something', () => {
    // "Tell me about every one of these." Treating it as unset is the classic falsy bug and would
    // silently hand the member the default instead.
    const kept = readMiningSettings(JSON.stringify({ default: 20, perMaterial: { 'Void Opal': 0 } }));

    expect(kept.perMaterial['Void Opal']).toBe(0);
  });

  it('MANDATORY: a file with the wrong shape entirely is replaced', () => {
    expect(readMiningSettings(JSON.stringify([1, 2, 3]))).toEqual(DEFAULT_MINING_SETTINGS);
    expect(readMiningSettings(JSON.stringify('a string'))).toEqual(DEFAULT_MINING_SETTINGS);
  });
});

describe('changing them', () => {
  it('MANDATORY: setting the default clamps', () => {
    expect(setDefaultThreshold(DEFAULT_MINING_SETTINGS, 42).default).toBe(42);
    expect(setDefaultThreshold(DEFAULT_MINING_SETTINGS, -5).default).toBe(0);
    expect(setDefaultThreshold(DEFAULT_MINING_SETTINGS, 900).default).toBe(100);
  });

  it('MANDATORY: a non-numeric default is refused, leaving the old one', () => {
    /*
     * Half-typed input arrives from a text box on every keystroke. Accepting it would blank the
     * setting the moment somebody selected all and started retyping.
     */
    const before = setDefaultThreshold(DEFAULT_MINING_SETTINGS, 30);
    const after = setDefaultThreshold(before, Number.NaN);

    expect(after.default).toBe(30);
  });

  it('MANDATORY: per-material thresholds add, update and clear', () => {
    let s = setMaterialThreshold(DEFAULT_MINING_SETTINGS, 'Painite', 12);
    expect(s.perMaterial['Painite']).toBe(12);

    s = setMaterialThreshold(s, 'Painite', 18);
    expect(s.perMaterial['Painite']).toBe(18);

    s = clearMaterialThreshold(s, 'Painite');
    expect(s.perMaterial['Painite'], 'clearing left the override behind').toBeUndefined();
  });

  it('MANDATORY: a material with an empty name is refused', () => {
    // An empty key would be an unlabelled row on the settings page that matches no rock.
    const s = setMaterialThreshold(DEFAULT_MINING_SETTINGS, '   ', 20);

    expect(Object.keys(s.perMaterial)).toHaveLength(0);
  });

  it('MANDATORY: changes never mutate what was passed in', () => {
    /*
     * The renderer holds the previous object in state. Mutating it would leave the UI and the saved
     * file agreeing with each other and both wrong, with no re-render to reveal it.
     */
    const before = setMaterialThreshold(DEFAULT_MINING_SETTINGS, 'Painite', 12);
    const after = setMaterialThreshold(before, 'Platinum', 30);

    expect(before.perMaterial['Platinum']).toBeUndefined();
    expect(after.perMaterial['Painite']).toBe(12);
  });
});
