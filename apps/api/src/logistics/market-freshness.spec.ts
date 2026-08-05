import { describe, expect, it } from 'vitest';
import { BELIEVABLE_DAYS, freshnessBand, rankPlaces } from './colony.service.js';

/**
 * How much to trust a price, and what that is allowed to cost somebody.
 *
 * ★ MEASURED AGAINST THE REAL MIRROR, 2026-08-03 ★
 *
 * Of the 18.6 million rows we hold, 6.4% were seen within a week, 27% within a month, and 46.6% are
 * older than three months. The oldest is from June 2020. So on any given shopping list, most of the
 * candidate prices describe a shelf nobody has looked at since spring.
 *
 * ★ AND WHAT THAT NEARLY COST — 2026-08-04 ★
 *
 * The first version banded age at 7 / 30 / 90 days and ranked all of it above price. Measured
 * across 2,051 real sourced (origin, commodity) pairs it changed the named station on ~37% of them,
 * at a median of +15%, a p90 of +104%, and one trade so bad it is now a test below: an 8.8x price
 * rise to buy four days of freshness, between two readings that were BOTH recent.
 *
 * These tests exist to hold the line that produced: a believable reading is a believable reading,
 * and price decides between them.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 4);
const ago = (days: number): Date => new Date(NOW - days * DAY);

const place = (over: {
  stationName: string;
  price: number;
  seenAt: Date | null;
  distance?: number;
}) => ({ distance: 0, ...over });

describe('whether a price can be believed', () => {
  it('answers one question, not four', () => {
    /*
     * Anything inside three months is evidence about the shelf; anything outside it is not. The
     * intermediate bands were the whole problem — they made a one-day step across an arbitrary line
     * outrank any price difference, however large.
     */
    expect(freshnessBand(ago(0), NOW)).toBe(0);
    expect(freshnessBand(ago(4), NOW)).toBe(0);
    expect(freshnessBand(ago(8), NOW)).toBe(0);
    expect(freshnessBand(ago(29), NOW)).toBe(0);
    expect(freshnessBand(ago(BELIEVABLE_DAYS), NOW)).toBe(0);
    expect(freshnessBand(ago(BELIEVABLE_DAYS + 1), NOW)).toBe(1);
    expect(freshnessBand(ago(400), NOW)).toBe(1);
  });

  it('treats a reading with no date as unbelievable, not as fresh', () => {
    // The direction matters. Sorting an undated row to the FRONT would promote exactly the rows we
    // know least about to the top of a member's shopping list.
    expect(freshnessBand(null, NOW)).toBe(1);
  });

  it('does not treat a future timestamp as ancient', () => {
    // Clock skew on a relay, or a journal uploaded from a machine set wrong. It is still the
    // freshest thing we have, and a negative age keeps it there rather than banishing it.
    expect(freshnessBand(new Date(NOW + DAY), NOW)).toBe(0);
  });
});

describe('what freshness is allowed to cost', () => {
  it('★ THE TIETHAY TRADE — never pays 8.8x for four days ★', () => {
    /*
     * The real pair, from the measurement run. Steel at Tiethay: 410 credits on an eight-day-old
     * reading, against 3,625 credits on a four-day-old one. The old banding preferred the dear one
     * because eight days and four days fell either side of a seven-day line.
     *
     * Nobody would sanction that trade if it were put to them in words, so the ranking must not make
     * it silently. Both readings are recent; price decides.
     */
    const ranked = rankPlaces(
      [
        place({ stationName: 'Dear but newer', price: 3625, seenAt: ago(4) }),
        place({ stationName: 'Cheap and recent', price: 410, seenAt: ago(8) }),
      ],
      'local',
      NOW,
    );

    expect(ranked[0]?.stationName).toBe('Cheap and recent');
  });

  it('still refuses a year-old reading however cheap it looks', () => {
    /*
     * The case the whole feature exists for, and it must survive the fix. A 209-credit price nobody
     * has confirmed since last summer is not a bargain — it is a claim about a shelf that has had a
     * year to empty. It sits below the believable option even at eighteen times the price.
     */
    const ranked = rankPlaces(
      [
        place({ stationName: 'A year stale', price: 209, seenAt: ago(400) }),
        place({ stationName: 'Seen this week', price: 3692, seenAt: ago(4) }),
      ],
      'local',
      NOW,
    );

    expect(ranked[0]?.stationName).toBe('Seen this week');
  });

  it('never lets either consideration beat the trip', () => {
    // Distance still leads. "Always prioritize local markets before sending out of system" was an
    // instruction, and neither price nor age is allowed to send somebody out of their own system.
    const ranked = rankPlaces(
      [
        place({ stationName: 'Far, cheap and fresh', price: 100, seenAt: ago(1), distance: 60 }),
        place({ stationName: 'Home', price: 4000, seenAt: ago(80), distance: 0 }),
      ],
      'local',
      NOW,
    );

    expect(ranked[0]?.stationName).toBe('Home');
  });

  it('leaves the sort somebody actually chose alone', () => {
    /*
     * A member who picked "cheapest" gets the cheapest, stale or not. Quietly demoting it would
     * answer a different question than the one on the control they just used — the page prints the
     * age instead and lets them decide.
     */
    const rows = [
      place({ stationName: 'Ancient bargain', price: 209, seenAt: ago(400) }),
      place({ stationName: 'Fresh and dear', price: 3692, seenAt: ago(1) }),
    ];

    expect(rankPlaces(rows, 'cheapest', NOW)[0]?.stationName).toBe('Ancient bargain');
  });
});

describe('the same list twice', () => {
  it('★ ORDERS TIES DETERMINISTICALLY, SO THE PAGE DOES NOT MOVE UNDER SOMEBODY ★', () => {
    /*
     * Found while measuring: two runs seconds apart named different stations for the same
     * commodity, with nothing in the data changed. Neither the comparator nor the underlying query
     * fully determined row order, so an exact tie on price and distance resolved however the rows
     * happened to arrive.
     *
     * A shopping list that changes its answer on a refresh is one nobody can act on — somebody
     * plots a route, reloads, and is told to go somewhere else.
     */
    const tied = [
      place({ stationName: 'Bravo', price: 1000, seenAt: ago(5) }),
      place({ stationName: 'Alfa', price: 1000, seenAt: ago(5) }),
      place({ stationName: 'Charlie', price: 1000, seenAt: ago(5) }),
    ];

    const first = rankPlaces(tied, 'local', NOW).map((p) => p.stationName);
    const shuffled = rankPlaces([...tied].reverse(), 'local', NOW).map((p) => p.stationName);

    expect(first).toEqual(['Alfa', 'Bravo', 'Charlie']);
    // The same set in a different arrival order must produce the same answer, which is the whole
    // point — the input order is exactly what used to leak through.
    expect(shuffled).toEqual(first);
  });
});
