import { describe, it, expect } from 'vitest';
import { syncInaraRanks, type InaraProfileRow, type SyncableCommander } from './inara-rank-sync.js';

/**
 * The sweep's job is not "fetch ranks" — it is "never make a card worse".
 *
 * Every test here is about the difference between Inara SAYING something and
 * Inara failing to say anything, because collapsing those two is the bug that
 * would empty the roster on a bad afternoon and leave nothing in the logs.
 */

type Profile = {
  squadronName: string | null;
  squadronRank: string | null;
  ranks: Array<{ key: string; label: string; name: string; index: number }>;
};

function store(commanders: SyncableCommander[]) {
  const saved: InaraProfileRow[] = [];
  return {
    saved,
    listCommanders: async () => commanders,
    save: async (rows: readonly InaraProfileRow[]) => {
      saved.push(...rows);
    },
  };
}

function source(answers: Map<string, Profile | null>) {
  return { getCommanderProfiles: async () => answers };
}

const AT = new Date('2026-07-28T12:00:00.000Z');
const ELITE = [{ key: 'Trade', label: 'Trade', name: 'Elite', index: 8 }];

describe('syncInaraRanks', () => {
  it('stores ranks for a commander Inara knows', async () => {
    const s = store([{ userId: 'u1', cmdrName: 'PEBBLEMERCHANT' }]);
    const report = await syncInaraRanks(
      s,
      source(
        new Map([['pebblemerchant', { squadronName: "Grim's Squad", squadronRank: 'Cadet', ranks: ELITE }]]),
      ),
      AT,
    );

    expect(report).toMatchObject({ asked: 1, found: 1, absent: 0, unanswered: 0 });
    expect(s.saved).toHaveLength(1);
    expect(s.saved[0]).toMatchObject({ userId: 'u1', isFound: true, fetchedAt: AT, ranks: ELITE });
  });

  it('records a commander Inara has never heard of as asked-and-absent', async () => {
    // The COMMON case: most members have no Inara account. It must be written,
    // not skipped, or every sweep re-asks about them forever.
    const s = store([{ userId: 'u1', cmdrName: 'NOBODY' }]);
    const report = await syncInaraRanks(s, source(new Map([['nobody', null]])), AT);

    expect(report).toMatchObject({ found: 0, absent: 1, unanswered: 0 });
    expect(s.saved[0]).toMatchObject({ isFound: false, ranks: [] });
  });

  it('WRITES NOTHING for a commander Inara did not answer for', async () => {
    /*
     * ★ THE ONE THAT MATTERS ★
     *
     * A failed chunk leaves names ABSENT from the map. Treating that as "no
     * ranks" would blank a commander's card every time Inara had a bad minute,
     * and the card would flicker between full and empty for reasons invisible
     * from the outside. The stored row must be left exactly as it was.
     */
    const s = store([{ userId: 'u1', cmdrName: 'PEBBLEMERCHANT' }]);
    const report = await syncInaraRanks(s, source(new Map()), AT);

    expect(report).toMatchObject({ asked: 1, found: 0, absent: 0, unanswered: 1 });
    expect(s.saved).toHaveLength(0);
  });

  it('matches names case-insensitively, because Elite does', async () => {
    const s = store([{ userId: 'u1', cmdrName: 'PebbleMerchant' }]);
    const report = await syncInaraRanks(
      s,
      source(new Map([['pebblemerchant', { squadronName: null, squadronRank: null, ranks: ELITE }]])),
      AT,
    );

    // Would report unanswered if the lookup were case-sensitive, and every
    // commander whose name is not stored lowercase would silently never sync.
    expect(report.found).toBe(1);
  });

  it('does not call Inara at all when nobody is verified', async () => {
    let called = false;
    const report = await syncInaraRanks(
      store([]),
      {
        getCommanderProfiles: async () => {
          called = true;
          return new Map();
        },
      },
      AT,
    );

    expect(called).toBe(false);
    expect(report.asked).toBe(0);
  });

  it('keeps going when only some commanders come back', async () => {
    const s = store([
      { userId: 'u1', cmdrName: 'ALPHA' },
      { userId: 'u2', cmdrName: 'BETA' },
      { userId: 'u3', cmdrName: 'GAMMA' },
    ]);
    const report = await syncInaraRanks(
      s,
      source(
        new Map<string, Profile | null>([
          ['alpha', { squadronName: null, squadronRank: null, ranks: ELITE }],
          ['gamma', null],
        ]),
      ),
      AT,
    );

    // One found, one absent, one unanswered — and the unanswered one does not
    // cost the other two their update.
    expect(report).toMatchObject({ asked: 3, found: 1, absent: 1, unanswered: 1 });
    expect(s.saved.map((r) => r.userId)).toEqual(['u1', 'u3']);
  });
});
