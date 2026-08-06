import { describe, expect, it } from 'vitest';
import {
  pipsOf,
  readFactionEffects,
  scoreContribution,
  BGS_POINTS_PER_PIP,
  HOLD_MULTIPLIER,
  type BgsStance,
} from './bgs.js';

/**
 * Reading what a mission actually did to a faction, and deciding whether it counts.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "create a BGS leaderboard, and allow the officers to choose what factions we want to be running
 * missions for etc, give instructions to the squad members etc."
 *
 * ★ THE DATA IS ALREADY THERE ★
 *
 * `MissionCompleted` carries `FactionEffects`: the faction, the system, and the influence as a run
 * of plus signs. Production holds 2,844 of these already, so the board launches with history rather
 * than empty — which is only true if this parser is right about events nobody will ever re-check.
 *
 * ★ THE ORDERS ARE WHAT MAKE THE BOARD WORTH HAVING ★
 *
 * Points come from influence pushed toward a faction the officers named, in a system they named,
 * in the direction they asked for. Missions run anywhere else score nothing. That single rule turns
 * the leaderboard from a scoreboard into an instrument of direction — officers change what the
 * squadron does by editing the watchlist rather than by asking twice in Discord.
 */

describe('reading influence off a mission', () => {
  it('MANDATORY: plus signs are pips', () => {
    // Frontier's own scale. Production carries the full range from one to five.
    expect(pipsOf('+')).toBe(1);
    expect(pipsOf('+++')).toBe(3);
    expect(pipsOf('+++++')).toBe(5);
  });

  it('MANDATORY: minus signs are negative pips', () => {
    /*
     * A failed or hostile mission pushes influence DOWN. Reading it as zero would let a member
     * harm a faction the squadron is backing and have it cost them nothing on the board.
     */
    expect(pipsOf('-')).toBe(-1);
    expect(pipsOf('---')).toBe(-3);
  });

  it('MANDATORY: anything else is nothing, not a guess', () => {
    /*
     * The mutation that proved this was under-tested: a check for "contains a plus" rather than
     * "is ALL pluses" passed everything here, because none of the rejected values happened to
     * contain one. A value we do not understand must score zero — counting its LENGTH would turn an
     * unrecognised string into an influence figure, which is the worst shape of wrong: plausible.
     */
    expect(pipsOf('+ +')).toBe(0);
    expect(pipsOf('+-+')).toBe(0);
    expect(pipsOf('++?')).toBe(0);
    expect(pipsOf('')).toBe(0);
    expect(pipsOf('None')).toBe(0);
    expect(pipsOf(null)).toBe(0);
    expect(pipsOf(undefined)).toBe(0);
    expect(pipsOf(42)).toBe(0);
  });

  it('MANDATORY: a real payload reads faction, system and pips', () => {
    // Shape copied from an actual production row.
    const effects = readFactionEffects({
      FactionEffects: [
        {
          Faction: 'Lords of Kamil',
          Influence: [{ Trend: 'UpGood', Influence: '++', SystemAddress: 9467852891473 }],
          Reputation: '++',
        },
      ],
    });

    expect(effects).toHaveLength(1);
    expect(effects[0]?.faction).toBe('Lords of Kamil');
    expect(effects[0]?.systemAddress).toBe('9467852891473');
    expect(effects[0]?.pips).toBe(2);
  });

  it('MANDATORY: one mission can move several factions in several systems', () => {
    /*
     * The common case, and the one a naive reader gets wrong: a mission handed in for one faction
     * routinely moves a rival down, and chained missions touch more than one system. Taking only
     * the first effect would silently lose most of what actually happened.
     */
    const effects = readFactionEffects({
      FactionEffects: [
        {
          Faction: 'Lords of Kamil',
          Influence: [
            { Influence: '++', SystemAddress: 1 },
            { Influence: '+', SystemAddress: 2 },
          ],
        },
        { Faction: 'Rivals of Kamil', Influence: [{ Influence: '-', SystemAddress: 1 }] },
      ],
    });

    expect(effects).toHaveLength(3);
    expect(effects.filter((e) => e.faction === 'Lords of Kamil')).toHaveLength(2);
    expect(effects.find((e) => e.faction === 'Rivals of Kamil')?.pips).toBe(-1);
  });

  it('MANDATORY: an effect with no influence at all is dropped', () => {
    /*
     * Plenty of missions pay reputation and move no influence. Recording them as zero-pip rows
     * would bulk out the ledger with entries that can never score and make "how much did we move
     * it" harder to read for no gain.
     */
    const effects = readFactionEffects({
      FactionEffects: [{ Faction: 'Lords of Kamil', Reputation: '++' }],
    });

    expect(effects).toHaveLength(0);
  });

  it('MANDATORY: a payload with no effects is empty, not a crash', () => {
    expect(readFactionEffects({})).toEqual([]);
    expect(readFactionEffects(null)).toEqual([]);
    expect(readFactionEffects({ FactionEffects: 'nonsense' })).toEqual([]);
  });

  it('MANDATORY: the system address is a string, because it does not fit a double', () => {
    /*
     * ★ THE SILENT CORRUPTION ★
     *
     * Frontier's SystemAddress runs past 2^53, where JavaScript numbers stop being exact. Carried
     * as a number, two different systems can round to the same value — so influence pushed in one
     * would be filed against another, and nothing anywhere would look wrong.
     */
    const effects = readFactionEffects({
      FactionEffects: [
        { Faction: 'A', Influence: [{ Influence: '+', SystemAddress: 9467852891473 }] },
      ],
    });

    /*
     * A real production address, which happens to fit. The assertion is on the TYPE, because that
     * is what protects the ones that do not: everything downstream — the ledger key, the group-by,
     * the join to a system name — compares this as an exact string rather than doing arithmetic on
     * a double that may already have rounded two systems together.
     *
     * The literal is deliberately one that fits: writing an oversized number here would lose
     * precision in the TEST, which the linter rightly refuses.
     */
    expect(typeof effects[0]?.systemAddress).toBe('string');
    expect(effects[0]?.systemAddress).toBe('9467852891473');
  });
});

describe('deciding what a contribution scores', () => {
  const watched = (stance: BgsStance) => ({ faction: 'Lords of Kamil', stance });

  it('MANDATORY: pushing a watched faction scores', () => {
    expect(scoreContribution({ pips: 3, order: watched('push') })).toBe(3 * BGS_POINTS_PER_PIP);
  });

  it('MANDATORY: a faction nobody asked for scores nothing', () => {
    /*
     * ★ THE RULE THE WHOLE BOARD EXISTS FOR ★
     *
     * Missions run for a faction the squadron is not backing do not count, however many. That is
     * what makes the leaderboard an instrument of direction rather than a record of who played
     * most — and it is the reason officers can change squadron behaviour by editing a list.
     */
    expect(scoreContribution({ pips: 5, order: null })).toBe(0);
  });

  it('MANDATORY: pushing where the order says AVOID scores nothing', () => {
    // Acting against a standing order must not pay. Otherwise the board rewards undoing the plan.
    expect(scoreContribution({ pips: 4, order: watched('avoid') })).toBe(0);
  });

  it('MANDATORY: holding steady pays, but less than pushing', () => {
    /*
     * A HOLD exists because influence pushed too high triggers an expansion the squadron does not
     * want. Paying nothing for it would leave the members keeping a system stable unrewarded;
     * paying full would make HOLD indistinguishable from PUSH and defeat the point.
     */
    const held = scoreContribution({ pips: 4, order: watched('hold') });

    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(scoreContribution({ pips: 4, order: watched('push') }));
    expect(held).toBe(Math.floor(4 * BGS_POINTS_PER_PIP * HOLD_MULTIPLIER));
  });

  it('MANDATORY: harming a faction we are backing costs points', () => {
    /*
     * Negative influence toward a PUSH order is the member actively working against the squadron's
     * plan. Scoring it as zero would make it free; scoring it negative makes the board honest.
     */
    expect(scoreContribution({ pips: -2, order: watched('push') })).toBe(-2 * BGS_POINTS_PER_PIP);
  });

  it('MANDATORY: harming a faction we asked people to AVOID is not rewarded either', () => {
    /*
     * Tempting to pay for it — pushing a rival down helps. But AVOID means "leave this alone",
     * usually because the officers are managing a delicate state, and paying for interference in
     * either direction invites exactly the meddling the order forbids.
     */
    expect(scoreContribution({ pips: -3, order: watched('avoid') })).toBe(0);
  });

  it('MANDATORY: zero pips scores zero whatever the order', () => {
    for (const stance of ['push', 'hold', 'avoid'] as const) {
      expect(scoreContribution({ pips: 0, order: watched(stance) })).toBe(0);
    }
  });
});
