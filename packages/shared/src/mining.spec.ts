import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINING_WEIGHT,
  miningPoints,
  materialWeight,
  CORE_ONLY_MATERIALS,
  worthShooting,
  DEFAULT_PROSPECT_THRESHOLD,
  continuesSession,
  MINING_SESSION_GAP_MINUTES,
} from './mining.js';
import { LEADERBOARDS, TIER_LADDERS, LEADERBOARD_BADGES as BADGES } from './leaderboards.js';

/**
 * Mining scoring, and the rock-by-rock decision the overlay renders.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "our own version of EDminer ... gamified leaderboard ... on refined materials ... must meet /
 * exceed ED tools as it works currently!"
 *
 * ★ WEIGHTED BY WHAT IT WAS, NOT BY WHAT IT SOLD FOR ★
 *
 * The obvious scale is credits, and it is wrong. Mineral prices move constantly — a board scored on
 * value would rerank itself when the market shifted, and a record of what somebody did in March is
 * not supposed to change in August.
 *
 * So a tonne is a tonne, multiplied by how hard that tonne was to get. Core-only materials need
 * seismic charges, a specific ship and actual skill; bauxite falls out of a laser by accident.
 */

describe('a tonne is worth what it cost to get', () => {
  it('MANDATORY: core-only materials are worth the most', () => {
    /*
     * Void Opals and Alexandrite cannot be laser-mined at all. Every tonne is a rock found,
     * charged, cracked and collected — the most deliberate thing a miner does.
     */
    for (const core of ['Void Opal', 'Alexandrite', 'Monazite', 'Musgravite']) {
      expect(materialWeight(core), `${core} should be a core-tier weight`).toBe(8);
    }
  });

  it('MANDATORY: an unknown mineral still scores, at the floor', () => {
    /*
     * Frontier adds commodities. A material we have never heard of must score SOMETHING — silently
     * dropping it would mean a miner's best night vanishing because the game shipped an update, and
     * the symptom would be a leaderboard that quietly disagrees with what people did.
     */
    expect(materialWeight('Some Future Mineral 2027')).toBe(DEFAULT_MINING_WEIGHT);
    expect(DEFAULT_MINING_WEIGHT).toBeGreaterThan(0);
  });

  it('MANDATORY: matching is case- and spacing-insensitive', () => {
    /*
     * The journal writes `Type` as an internal symbol and `Type_Localised` as a display name, and
     * which one arrives depends on the commodity. "Low Temperature Diamonds", "lowtemperature
     * diamonds" and "LowTemperatureDiamonds" are one mineral and must score once.
     */
    const canonical = materialWeight('Low Temperature Diamonds');
    expect(materialWeight('low temperature diamonds')).toBe(canonical);
    expect(materialWeight('LowTemperatureDiamonds')).toBe(canonical);
    expect(materialWeight('  Low Temperature Diamonds  ')).toBe(canonical);
  });

  it('MANDATORY: points are tonnes times the weight', () => {
    expect(miningPoints('Void Opal', 10)).toBe(80);
    expect(miningPoints('Painite', 10)).toBe(40);
    expect(miningPoints('Bauxite', 10)).toBe(10);
  });

  it('MANDATORY: a fractional or negative tonnage cannot invent points', () => {
    /*
     * `MiningRefined` fires once per whole tonne, so anything else is a malformed event or a
     * replay. Scoring it would let a broken client mint points.
     */
    expect(miningPoints('Void Opal', 0)).toBe(0);
    expect(miningPoints('Void Opal', -5)).toBe(0);
    expect(miningPoints('Void Opal', 1.5)).toBe(8);
  });
});

describe('the board sits with the other three', () => {
  it('MANDATORY: Deep Core is a real leaderboard', () => {
    const board = LEADERBOARDS.find((b) => b.key === 'mining');
    expect(board, 'the mining board is not registered, so no page will render it').toBeDefined();
    expect(board?.name).toBe('Deep Core');
  });

  it('MANDATORY: it has the same four rungs as every other board', () => {
    /*
     * The page renders four boards without knowing which table fed each. A board with a different
     * number of tiers would be a second shape for the same component to learn.
     */
    const ladder = TIER_LADDERS.mining;
    expect(ladder).toHaveLength(4);
    expect(ladder.map((t) => t.tier)).toEqual(['bronze', 'silver', 'gold', 'platinum']);
  });

  it('MANDATORY: the ladder only ever climbs', () => {
    // A threshold below the one beneath it would award a higher rank for less work.
    const ladder = TIER_LADDERS.mining;
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]?.at, `${ladder[i]?.name} is not above ${ladder[i - 1]?.name}`).toBeGreaterThan(
        ladder[i - 1]?.at ?? 0,
      );
    }
  });

  it('MANDATORY: its tier badge keys are stable and board-scoped', () => {
    /*
     * `member_badges` stores keys. Renaming a rank must never strand an award, and two boards
     * sharing a key would show a miner wearing a trader's rank.
     */
    for (const tier of ['bronze', 'silver', 'gold', 'platinum']) {
      expect(BADGES.some((b) => b.key === `mining-${tier}`), `mining-${tier} is missing`).toBe(true);
    }
  });

  it('every mining badge names the board it belongs to', () => {
    for (const badge of BADGES.filter((b) => b.key.startsWith('mining-'))) {
      expect(badge.board).toBe('mining');
    }
  });
});

describe('whether to shoot this rock', () => {
  /*
   * ★ THE DECISION THE OVERLAY EXISTS FOR ★
   *
   * A prospected rock drifts past in a couple of seconds. The whole skill of laser mining is
   * deciding, in that window, whether it is worth the time — and that decision is a percentage
   * against a number the member chose.
   *
   * Squadron owner, 2026-08-06: "allow the user the option to select percentages". Per material,
   * because 20% Painite is a good rock and 20% Bauxite is not worth the limpet.
   */
  it('MANDATORY: a rock over the threshold is worth shooting', () => {
    expect(worthShooting('Painite', 22, { default: 15, perMaterial: {} })).toBe(true);
  });

  it('MANDATORY: a rock under it is not', () => {
    expect(worthShooting('Painite', 9, { default: 15, perMaterial: {} })).toBe(false);
  });

  it('MANDATORY: a per-material threshold beats the default', () => {
    const settings = { default: 30, perMaterial: { Painite: 10 } };

    expect(worthShooting('Painite', 12, settings), 'the per-material floor was ignored').toBe(true);
    expect(worthShooting('Platinum', 12, settings), 'the default should still apply').toBe(false);
  });

  it('MANDATORY: a per-material threshold of zero is honoured, not treated as unset', () => {
    /*
     * The classic falsy bug. A member who sets Void Opal to 0 means "tell me about every one", and
     * `?? default` would silently give them the default instead — the setting would look saved and
     * do nothing.
     */
    expect(worthShooting('Void Opal', 1, { default: 50, perMaterial: { 'Void Opal': 0 } })).toBe(true);
  });

  it('MANDATORY: material matching is as forgiving as the scoring is', () => {
    // Same reason: the journal's spelling varies and a threshold that only matches one form is a
    // setting that works for some rocks and not others, with no pattern the member could see.
    expect(worthShooting('lowtemperaturediamonds', 20, {
      default: 90,
      perMaterial: { 'Low Temperature Diamonds': 10 },
    })).toBe(true);
  });

  it('has a sane default for somebody who has changed nothing', () => {
    expect(DEFAULT_PROSPECT_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_PROSPECT_THRESHOLD).toBeLessThan(100);
  });
});

describe('the core-only list is the one the weights use', () => {
  it('MANDATORY: every core-only material carries the core weight', () => {
    /*
     * Two lists that must agree: the weights table and the set the badges and the UI call "core".
     * Letting them drift would mean a material described as core-only scoring like bauxite.
     */
    for (const material of CORE_ONLY_MATERIALS) {
      expect(materialWeight(material), `${material} is listed core-only but is not weighted so`).toBe(8);
    }
  });
});

/**
 * ★ WHERE ONE EVENING ENDS AND THE NEXT BEGINS ★
 *
 * A mining session is a continuous stretch of rocks. It has to be decided INCREMENTALLY, because
 * the scorer reads telemetry in batches behind a cursor and never holds a member's whole history in
 * memory — so the question is always the narrow one: does this rock join the session that is
 * already open, or start a new one?
 *
 * The answer is what "tonnes per hour" divides by. Get it wrong in one direction and an evening
 * splits into forty sessions of one rock each; wrong in the other and a fortnight of mining is a
 * single session with a rate near zero.
 */
describe('deciding when a mining session continues', () => {
  const T0 = Date.parse('2026-08-06T20:00:00Z');

  it('MANDATORY: nothing open means nothing to continue', () => {
    // The first rock a member ever prospects has no predecessor. It opens a session.
    expect(continuesSession(null, T0)).toBe(false);
  });

  it('MANDATORY: rocks minutes apart are the same session', () => {
    expect(continuesSession(T0, T0 + 60_000)).toBe(true);
    expect(continuesSession(T0, T0 + 20 * 60_000)).toBe(true);
  });

  it('MANDATORY: a long gap starts a new session', () => {
    // Next evening. Joining these would divide one night's tonnage by twenty-four hours.
    expect(continuesSession(T0, T0 + 24 * 3_600_000)).toBe(false);
  });

  it('MANDATORY: the boundary itself still continues', () => {
    /*
     * A member who flies to the station, sells, and comes back inside the window is still on the
     * same trip. Exactly-at-the-gap is the common case of that, not an edge case — it is what a
     * round trip to a nearby station actually costs.
     */
    expect(continuesSession(T0, T0 + MINING_SESSION_GAP_MINUTES * 60_000)).toBe(true);
    expect(continuesSession(T0, T0 + MINING_SESSION_GAP_MINUTES * 60_000 + 1)).toBe(false);
  });

  it('MANDATORY: an out-of-order event joins rather than opening a phantom session', () => {
    /*
     * Journals upload in chunks and clocks are not perfectly monotonic. A rock timestamped a second
     * BEFORE the previous one must not open a second session — that would leave two overlapping
     * sessions for the same evening, and every rate computed from either would be wrong.
     */
    expect(continuesSession(T0, T0 - 1_000)).toBe(true);
  });

  it('MANDATORY: a rock from last week does not join tonight', () => {
    /*
     * The mutation that proved this test was missing: without the absolute difference, ANY
     * backwards step counts as "no gap", so a member re-uploading an old journal would have every
     * rock in it swallowed by whatever session is currently open. One session would then span a
     * fortnight and its tonnes-per-hour would round to zero.
     *
     * Small backwards steps join (clocks wobble); large ones are a different evening.
     */
    expect(continuesSession(T0, T0 - 7 * 24 * 3_600_000)).toBe(false);
  });

  it('MANDATORY: Date objects and epoch milliseconds decide alike', () => {
    // The worker reads `Date` off Postgres; the companion holds numbers. One rule for both.
    expect(continuesSession(new Date(T0), new Date(T0 + 60_000))).toBe(true);
    expect(continuesSession(new Date(T0), new Date(T0 + 24 * 3_600_000))).toBe(false);
  });
});
