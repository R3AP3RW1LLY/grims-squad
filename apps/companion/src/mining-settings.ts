/**
 * The percentages a member chooses, and what happens to nonsense.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "add full on mining companion app settings to allow the user the option to select percentages"
 *
 * ★ WHY VALIDATION IS ALMOST THE WHOLE FILE ★
 *
 * These numbers come off a text box and are then compared against a percentage from the game on
 * every single rock. A NaN slipping through does not throw: `percent >= NaN` is false for ever, so
 * the overlay silently stops highlighting anything and the member has no way to tell whether the
 * ring is poor or their setting is broken. That is the worst shape of bug — invisible, and it looks
 * like the game's fault.
 *
 * So every entry point clamps and rejects, and a stored file that has been hand-edited or written
 * by an older version is repaired on read rather than trusted.
 *
 * ★ PER MATERIAL, NOT ONE NUMBER ★
 *
 * 12% Painite is a good rock; 12% Bauxite is not worth the limpet. A single global threshold makes
 * the alert useless in exactly the mixed rings where it matters most.
 */

import { DEFAULT_PROSPECT_THRESHOLD, type ProspectThresholds } from '@grims/shared/mining';

export interface MiningSettings extends ProspectThresholds {
  readonly default: number;
  readonly perMaterial: Readonly<Record<string, number>>;
}

export const DEFAULT_MINING_SETTINGS: MiningSettings = {
  default: DEFAULT_PROSPECT_THRESHOLD,
  perMaterial: {},
};

/**
 * A percentage, or null if it is not one.
 *
 * Clamped rather than rejected when out of range: somebody who typed 150 meant "only the very
 * best", and silently reverting them to the default is a setting that visibly refuses to save.
 */
function percentOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

/** Read what was saved, repairing anything that would break the comparison later. */
export function readMiningSettings(raw: string | null | undefined): MiningSettings {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_MINING_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_MINING_SETTINGS;
  }

  // An array, a string or a null are all "not a settings object" — replaced rather than picked at.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_MINING_SETTINGS;
  }

  const obj = parsed as Record<string, unknown>;

  const perMaterial: Record<string, number> = {};
  const savedPer = obj['perMaterial'];
  if (typeof savedPer === 'object' && savedPer !== null && !Array.isArray(savedPer)) {
    for (const [name, value] of Object.entries(savedPer as Record<string, unknown>)) {
      if (name.trim() === '') continue;
      const percent = percentOrNull(value);
      /*
       * A bad override is DROPPED rather than defaulted. Keeping the row with a made-up number
       * would show the member a threshold they never chose; dropping it makes the material fall
       * back to the default, which is what an absent override means anyway.
       */
      if (percent === null) continue;
      perMaterial[name.trim()] = percent;
    }
  }

  return {
    default: percentOrNull(obj['default']) ?? DEFAULT_MINING_SETTINGS.default,
    perMaterial,
  };
}

/**
 * Change the fallback threshold.
 *
 * A non-numeric value leaves the previous one alone. Half-typed input arrives from a text box on
 * every keystroke, and accepting it would blank the setting the moment somebody selected all and
 * started retyping.
 */
export function setDefaultThreshold(settings: MiningSettings, value: number): MiningSettings {
  const percent = percentOrNull(value);
  if (percent === null) return settings;
  return { ...settings, default: percent };
}

/** Add or update one material's own threshold. */
export function setMaterialThreshold(
  settings: MiningSettings,
  material: string,
  value: number,
): MiningSettings {
  const name = material.trim();
  // An empty key would be an unlabelled row on the settings page matching no rock.
  if (name === '') return settings;

  const percent = percentOrNull(value);
  if (percent === null) return settings;

  /*
   * A NEW object every time, never a mutation. The renderer holds the previous one in state, and
   * mutating it would leave the UI and the saved file agreeing with each other and both wrong,
   * with no re-render to reveal it.
   */
  return { ...settings, perMaterial: { ...settings.perMaterial, [name]: percent } };
}

/** Remove one material's override, so it falls back to the default. */
export function clearMaterialThreshold(settings: MiningSettings, material: string): MiningSettings {
  const name = material.trim();
  if (!(name in settings.perMaterial)) return settings;

  const next = { ...settings.perMaterial };
  delete next[name];
  return { ...settings, perMaterial: next };
}
