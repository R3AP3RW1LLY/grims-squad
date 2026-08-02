import { describe, it, expect } from 'vitest';
import { trackDocked, isFresh, DOCK_FRESH_MS, type DockedAt, type ParsedLike } from './docked.js';

/**
 * Knowing where the commander is docked, so the app can fill a form in for them.
 *
 * ★ SQUADRON OWNER, 2026-08-02 ★
 *
 * "it should appear automatically in the companion app on the new project page if it is not being
 * used please!" — of the market id, which the form had been asking a member to find and retype.
 *
 * The failure this guards is specific and quiet: a market id is the JOIN TO REALITY for a project.
 * Get it wrong and the project sits on the board looking fine and silently never updates, because
 * no journal event will ever match it. So a wrong answer here is worse than no answer, and every
 * test below is a way of getting it wrong.
 */

const ev = (name: string, data: Record<string, unknown>, at = '2026-08-02T10:00:00Z'): ParsedLike => ({
  name,
  occurredAt: at,
  data,
});

const DOCKED = ev('Docked', {
  MarketID: 3_706_117_632,
  StationName: 'Ambrose Dock',
  StarSystem: 'HIP 58832',
});

describe('tracking where somebody is docked', () => {
  it('reads a Docked event', () => {
    expect(trackDocked(null, [DOCKED])).toEqual({
      marketId: '3706117632',
      stationName: 'Ambrose Dock',
      systemName: 'HIP 58832',
      at: '2026-08-02T10:00:00Z',
    });
  });

  it('MANDATORY: keeps the market id exact', () => {
    /*
     * Ids are large and are the join to reality. A rounded or exponential one produces a project
     * that never matches a journal event — a board entry that looks fine and never updates.
     */
    const seen = trackDocked(null, [ev('Docked', {
      MarketID: 3_706_117_632,
      StationName: 'X',
      StarSystem: 'Y',
    })]);

    expect(seen?.marketId).toBe('3706117632');
    expect(seen?.marketId).not.toMatch(/[eE+.]/);
  });

  it('accepts an id that arrives as a string', () => {
    const seen = trackDocked(null, [ev('Docked', {
      MarketID: '3706117632',
      StationName: 'X',
      StarSystem: 'Y',
    })]);
    expect(seen?.marketId).toBe('3706117632');
  });

  it('MANDATORY: ignores a half-event rather than replacing a good one', () => {
    // An id with no name cannot be shown; a name with no id cannot be posted. Either way the old
    // value is more useful than a broken new one.
    const before = trackDocked(null, [DOCKED]);

    expect(trackDocked(before, [ev('Docked', { StationName: 'No id here' })])).toEqual(before);
    expect(trackDocked(before, [ev('Docked', { MarketID: 42 })])).toEqual(before);
  });

  it('takes the LAST dock in a batch', () => {
    // A pass can cover several minutes of journal. The newest is where they are.
    const second = ev('Docked', { MarketID: 99, StationName: 'Second', StarSystem: 'Z' });
    expect(trackDocked(null, [DOCKED, second])?.stationName).toBe('Second');
  });

  it('remembers across passes, because nothing repeats the station', () => {
    // Somebody docks in one twenty-second window and posts a project ten minutes later. Nothing in
    // between mentions the station again.
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('Scan', {}), ev('Music', {})])).toEqual(before);
  });
});

describe('leaving', () => {
  it('MANDATORY: Undocked clears it', () => {
    /*
     * Without this the app keeps claiming a member is at a station they left an hour ago, and
     * pre-fills the project form with the wrong site.
     */
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('Undocked', {})])).toBeNull();
  });

  it('MANDATORY: an FSD jump clears it too', () => {
    /*
     * A journal can be missing the Undocked — the app may have started mid-session, or the event
     * may sit in a chunk never read. Arriving in another system is unambiguous.
     */
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('FSDJump', { StarSystem: 'Somewhere else' })])).toBeNull();
  });

  it('MANDATORY: Location does NOT clear it', () => {
    /*
     * `Location` fires on logging in and carries `Docked: true` when a member resumes at a station.
     * Treating it as a departure would forget where somebody is every time they start the game —
     * which is exactly when they are most likely to want the form filled in.
     */
    const before = trackDocked(null, [DOCKED]);
    const resumed = trackDocked(before, [
      ev('Location', {
        Docked: true,
        MarketID: 3_706_117_632,
        StationName: 'Ambrose Dock',
        StarSystem: 'HIP 58832',
      }),
    ]);

    expect(resumed?.marketId).toBe('3706117632');
  });

  it('a Location that is NOT docked leaves the old value alone', () => {
    // Logging in in open space says nothing about a station. It is neither an arrival nor a
    // departure, and inventing either would be a guess.
    const before = trackDocked(null, [DOCKED]);
    expect(trackDocked(before, [ev('Location', { Docked: false, StarSystem: 'Deep space' })])).toEqual(
      before,
    );
  });
});

describe('how fresh a dock is', () => {
  const NOW = Date.parse('2026-08-02T12:00:00Z');
  const at = (iso: string): DockedAt => ({
    marketId: '1',
    stationName: 'X',
    systemName: 'Y',
    at: iso,
  });

  it('accepts one from this session', () => {
    expect(isFresh(at('2026-08-02T11:30:00Z'), NOW)).toBe(true);
  });

  it('MANDATORY: refuses a stale one', () => {
    /*
     * The app may have been closed for days with a Docked as the last thing it saw. Pre-filling a
     * form with a station somebody left on Tuesday creates a project pointing at the wrong site —
     * and it would silently never update, which reads as the sync being broken.
     */
    expect(isFresh(at('2026-07-28T09:00:00Z'), NOW)).toBe(false);
    expect(isFresh(at(new Date(NOW - DOCK_FRESH_MS - 1000).toISOString()), NOW)).toBe(false);
  });

  it('refuses a timestamp from the future', () => {
    // A clock disagreement, not a fresh dock.
    expect(isFresh(at('2026-08-03T12:00:00Z'), NOW)).toBe(false);
  });

  it('tolerates a small clock skew', () => {
    // The game's clock and ours differing by minutes is normal and harmless.
    expect(isFresh(at(new Date(NOW + 60_000).toISOString()), NOW)).toBe(true);
  });

  it('refuses nothing, and refuses nonsense', () => {
    expect(isFresh(null, NOW)).toBe(false);
    expect(isFresh(at('not a date'), NOW)).toBe(false);
  });
});
