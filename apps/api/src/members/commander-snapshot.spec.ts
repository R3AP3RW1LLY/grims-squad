import { describe, it, expect } from 'vitest';
import { buildSnapshots, EMPTY_SNAPSHOT, type SnapshotEvent } from './commander-snapshot.js';
import { eliteRankName, describeEliteRanks } from '@grims/shared';

/**
 * Turning raw journal events into what a roster card shows.
 *
 * Every fixture below is the SHAPE of real data taken from the running
 * database — `{"CQC":0,"Trade":8,"Combat":0,"Explore":3}` and
 * `{"Ship":"Explorer_NX","Ship_Localised":"Caspian Explorer"}` — rather than
 * invented. A parser tested only against tidy fixtures is a parser tested
 * against its own assumptions.
 */

const at = (iso: string) => new Date(iso);

const event = (over: Partial<SnapshotEvent> = {}): SnapshotEvent => ({
  userId: 'u1',
  eventType: 'Rank',
  occurredAt: at('2026-07-28T02:05:00Z'),
  payload: { CQC: 0, Trade: 8, Combat: 0, Empire: 0, Explore: 3, Soldier: 0 },
  ...over,
});

describe('rank names', () => {
  it('MANDATORY: turns the integers into what players call them', () => {
    // Nobody thinks of themselves as "Trade 8". They think "Elite".
    expect(eliteRankName('Trade', 8)).toBe('Elite');
    expect(eliteRankName('Explore', 3)).toBe('Surveyor');
    expect(eliteRankName('Combat', 0)).toBe('Harmless');
  });

  it('MANDATORY: index 0 is a real rank, not a missing one', () => {
    // Harmless is a rank somebody holds. Treating 0 as absent would silently
    // drop the ladder every new commander starts on.
    expect(eliteRankName('Combat', 0)).not.toBeNull();
  });

  it('handles the ranks above Elite rather than dropping them', () => {
    /*
     * Frontier added Elite I–V above Elite, so the index runs past the named
     * ladder. Rendering nothing for somebody who ground past Elite would read
     * as a bug, and it is the opposite of nothing.
     */
    expect(eliteRankName('Combat', 10)).toBe('Elite +2');
  });

  it('refuses anything that is not a rank index', () => {
    for (const bad of [null, undefined, -1, 'Elite', 1.5]) {
      expect(eliteRankName('Trade', bad), String(bad)).toBeNull();
    }
  });

  it('MANDATORY: keeps the index alongside the name', () => {
    /*
     * ★ THE BUG THIS CAUGHT ★
     *
     * The card shows a commander's best three ranks. Sorted by NAME, "Surveyor"
     * beats "Elite" — so a Trade Elite was listed below an Exploration
     * Surveyor, which is exactly backwards. Found against real data, not by
     * reading the code.
     */
    const ranks = describeEliteRanks({ Trade: 8, Explore: 3, Combat: 0 });
    const best = [...ranks].sort((a, b) => b.index - a.index)[0];

    expect(best?.name).toBe('Elite');
  });
});

describe('building a snapshot', () => {
  it('reads ranks, ship, squadron rank and last-played', () => {
    const snapshots = buildSnapshots([
      event(),
      event({
        eventType: 'LoadGame',
        payload: { Ship: 'Explorer_NX', Ship_Localised: 'Caspian Explorer', Commander: 'PEBBLE' },
      }),
      event({ eventType: 'SquadronStartup', payload: { CurrentRank: 14, SquadronName: 'GRIMS SQUAD' } }),
    ]);

    const s = snapshots.get('u1');
    expect(s?.currentShip).toBe('Caspian Explorer');
    expect(s?.squadronRank).toBe(14);
    expect(s?.lastPlayedAt).toBe('2026-07-28T02:05:00.000Z');
    expect(s?.ranks.find((r) => r.key === 'Trade')?.name).toBe('Elite');
  });

  it('MANDATORY: prefers the LOCALISED ship name', () => {
    // `Explorer_NX` is an internal symbol. "Caspian Explorer" is the ship.
    const s = buildSnapshots([
      event({ eventType: 'LoadGame', payload: { Ship: 'Explorer_NX', Ship_Localised: 'Caspian Explorer' } }),
    ]).get('u1');

    expect(s?.currentShip).toBe('Caspian Explorer');
  });

  it('falls back to the raw ship name when there is no localisation', () => {
    const s = buildSnapshots([
      event({ eventType: 'LoadGame', payload: { Ship: 'Explorer_NX' } }),
    ]).get('u1');

    expect(s?.currentShip).toBe('Explorer_NX');
  });

  it('MANDATORY: keeps the NEWEST event when several arrive for one type', () => {
    /*
     * The caller narrows in SQL, so this should not happen. Guarded anyway: if
     * a distinct clause is ever dropped or a join widened, the failure degrades
     * to slower rather than to a card showing somebody's ranks from March.
     */
    const s = buildSnapshots([
      event({ occurredAt: at('2026-01-01T00:00:00Z'), payload: { Trade: 0 } }),
      event({ occurredAt: at('2026-07-28T02:05:00Z'), payload: { Trade: 8 } }),
    ]).get('u1');

    expect(s?.ranks.find((r) => r.key === 'Trade')?.name).toBe('Elite');
  });

  it('keeps members separate', () => {
    const snapshots = buildSnapshots([
      event({ userId: 'a', payload: { Trade: 8 } }),
      event({ userId: 'b', payload: { Trade: 0 } }),
    ]);

    expect(snapshots.get('a')?.ranks[0]?.name).toBe('Elite');
    expect(snapshots.get('b')?.ranks[0]?.name).toBe('Penniless');
  });

  it('MANDATORY: a member with no journal data gets an empty snapshot, not a crash', () => {
    // Most of the squadron will not be running the app. Their cards must still
    // render — as a name and a rank, which is the point.
    expect(buildSnapshots([]).size).toBe(0);
    expect(EMPTY_SNAPSHOT.ranks).toEqual([]);
    expect(EMPTY_SNAPSHOT.currentShip).toBeNull();
  });

  it('survives a payload that is not an object', () => {
    // Nothing should ever store one. Costing a card rather than the page is the
    // right failure if something does.
    const s = buildSnapshots([event({ payload: 'nonsense' })]).get('u1');
    expect(s?.ranks).toEqual([]);
  });
});
