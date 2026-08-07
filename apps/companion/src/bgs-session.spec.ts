import { describe, expect, it } from 'vitest';
import { EMPTY_BGS, foldMission, standingFor, type BgsStanding } from './bgs-session.js';

/**
 * The BGS session panel's arithmetic.
 *
 * ★ THE NUMBER SHOWN HERE IS THE NUMBER THAT LANDS ★
 *
 * Same rule as the refinery panel: this scores with the hub's own `scoreContribution`, against the
 * hub's own orders. A panel that estimated separately would eventually disagree with the
 * leaderboard, and the member watching it all evening would be right to trust the panel and wrong
 * about their score.
 */

const ORDERS: BgsStanding[] = [
  { faction: "Grim's Squad", stance: 'push', systemName: 'Shinrarta Dezhra', priority: 1, guidance: 'Take couriers.' },
  { faction: 'Rival Corp', stance: 'suppress', systemName: 'Shinrarta Dezhra', priority: 2, guidance: null },
  { faction: 'Far Away Inc', stance: 'push', systemName: 'Sol', priority: 1, guidance: null },
];

function mission(effects: unknown): unknown {
  return { FactionEffects: effects };
}

describe('the BGS session fold', () => {
  it('scores a mission against the standing order for the faction it helped', () => {
    const out = foldMission(
      EMPTY_BGS,
      mission([
        { Faction: "Grim's Squad", Influence: [{ SystemAddress: '1', Influence: '++' }] },
      ]),
      ORDERS,
      1_000,
    );

    expect(out.missions).toBe(1);
    expect(out.pips).toBe(2);
    expect(out.points).toBe(20);
    expect(out.byFaction["Grim's Squad"]).toBe(2);
  });

  it('pays for weakening a faction we were told to suppress', () => {
    /*
     * ★ THE SIGN IS THE WHOLE POINT ★
     *
     * A pip taken OFF a rival we are suppressing is the work that was asked for. Treating every
     * stance's pips alike is the obvious mistake, and it would show a member a falling score for
     * doing exactly what the officers ordered.
     */
    const out = foldMission(
      EMPTY_BGS,
      mission([{ Faction: 'Rival Corp', Influence: [{ SystemAddress: '1', Influence: '--' }] }]),
      ORDERS,
      1_000,
    );

    expect(out.points).toBe(20);
  });

  it('counts influence for a faction with no order, and pays nothing for it', () => {
    const out = foldMission(
      EMPTY_BGS,
      mission([{ Faction: 'Nobody Asked', Influence: [{ SystemAddress: '1', Influence: '+' }] }]),
      ORDERS,
      1_000,
    );

    /*
     * The pip still happened, so the panel still shows it — a member who moved influence somewhere
     * unordered should see that they did, not a panel claiming nothing occurred. It simply pays
     * nothing, which is the rule the whole board rests on.
     */
    expect(out.pips).toBe(1);
    expect(out.points).toBe(0);
    expect(out.missions).toBe(1);
  });

  it('folds every faction one mission moved, not just the first', () => {
    // A mission handed in for one faction routinely pushes a rival the other way.
    const out = foldMission(
      EMPTY_BGS,
      mission([
        { Faction: "Grim's Squad", Influence: [{ SystemAddress: '1', Influence: '+' }] },
        { Faction: 'Rival Corp', Influence: [{ SystemAddress: '1', Influence: '-' }] },
      ]),
      ORDERS,
      1_000,
    );

    expect(out.missions, 'one mission was counted twice').toBe(1);
    expect(out.points, 'the second faction effect was dropped').toBe(20);
  });

  it('starts the clock on the first mission, not on app launch', () => {
    /*
     * A session that begins when the app opens reports a rate of nothing-per-hour to somebody who
     * left it running overnight — the same reasoning the refinery panel uses.
     */
    expect(EMPTY_BGS.startedAt).toBeNull();

    const out = foldMission(
      EMPTY_BGS,
      mission([{ Faction: "Grim's Squad", Influence: [{ SystemAddress: '1', Influence: '+' }] }]),
      ORDERS,
      5_000,
    );
    expect(out.startedAt).toBe(5_000);

    const later = foldMission(
      out,
      mission([{ Faction: "Grim's Squad", Influence: [{ SystemAddress: '1', Influence: '+' }] }]),
      ORDERS,
      9_000,
    );
    expect(later.startedAt, 'the clock restarted mid-session').toBe(5_000);
    expect(later.lastAt).toBe(9_000);
  });

  it('ignores a mission that moved no influence at all', () => {
    // Reputation-only missions carry no Influence array. Counting them would make the panel claim
    // work that did not move the needle.
    const out = foldMission(EMPTY_BGS, mission([{ Faction: "Grim's Squad" }]), ORDERS, 1_000);
    expect(out).toBe(EMPTY_BGS);
  });
});

describe('what applies where the member is standing', () => {
  it('puts the orders for this system first, in priority order', () => {
    const here = standingFor(ORDERS, 'Shinrarta Dezhra');

    expect(here.here.map((o) => o.faction)).toEqual(["Grim's Squad", 'Rival Corp']);
    /*
     * The count of orders somewhere else is what tells a member the squadron has work for them that
     * this system cannot give — without it, a system with no orders looks identical to a squadron
     * with no orders at all.
     */
    expect(here.elsewhere).toBe(1);
  });

  it('says nothing applies here rather than showing another system by mistake', () => {
    const here = standingFor(ORDERS, 'Deciat');
    expect(here.here).toHaveLength(0);
    expect(here.elsewhere).toBe(3);
  });

  it('matches the system name the way the game writes it, ignoring case', () => {
    expect(standingFor(ORDERS, 'shinrarta dezhra').here).toHaveLength(2);
  });

  it('has nothing to say when we do not know where the member is', () => {
    const here = standingFor(ORDERS, null);
    expect(here.here).toHaveLength(0);
    expect(here.elsewhere, 'the orders were hidden entirely').toBe(3);
  });
});
