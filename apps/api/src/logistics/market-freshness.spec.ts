import { describe, expect, it } from 'vitest';
import { freshnessBand } from './colony.service.js';

/**
 * How much to trust a price.
 *
 * ★ MEASURED AGAINST THE REAL MIRROR, 2026-08-03 ★
 *
 * Of the ten million rows we hold, 6.4% were seen within a week, 27% within a month, and 46.6% are
 * older than three months. The oldest is from June 2020. So this is not a hypothetical: on any
 * given shopping list, most of the candidate prices are describing a shelf nobody has looked at
 * since spring.
 *
 * A price is a claim about STOCK, and stock is what somebody is flying forty light years to
 * collect. An old reading is not slightly worse information — the trip it sends them on can be
 * entirely wasted.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 3);
const ago = (days: number): Date => new Date(NOW - days * DAY);

describe('how old a price is', () => {
  it('bands it rather than scoring it continuously', () => {
    /*
     * Nobody flying cares about the difference between a nine-day-old reading and an eleven-day-old
     * one. A continuous score would also reshuffle the whole list every time the clock ticked past
     * a threshold, which makes a page that changes under somebody mid-decision.
     */
    expect(freshnessBand(ago(0), NOW)).toBe(0);
    expect(freshnessBand(ago(7), NOW)).toBe(0);
    expect(freshnessBand(ago(8), NOW)).toBe(1);
    expect(freshnessBand(ago(30), NOW)).toBe(1);
    expect(freshnessBand(ago(31), NOW)).toBe(2);
    expect(freshnessBand(ago(90), NOW)).toBe(2);
    expect(freshnessBand(ago(91), NOW)).toBe(3);
  });

  it('treats a reading with no date as the oldest kind, not the newest', () => {
    /*
     * The direction matters. Sorting an unknown date to the FRONT would promote exactly the rows we
     * know least about to the top of a member's shopping list.
     */
    expect(freshnessBand(null, NOW)).toBe(3);
    expect(freshnessBand(null, NOW)).toBeGreaterThan(freshnessBand(ago(60), NOW));
  });

  it('does not treat a future timestamp as ancient', () => {
    // Clock skew on a relay, or a journal uploaded from a machine set wrong. It is still the
    // freshest thing we have, and flooring the age keeps it there rather than banishing it.
    expect(freshnessBand(new Date(NOW + DAY), NOW)).toBe(0);
  });
});
