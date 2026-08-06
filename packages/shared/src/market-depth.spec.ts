import { describe, expect, it } from 'vitest';
import { depthOf, DEPTH_COMFORTABLE } from './market-depth.js';

/**
 * Whether a station can actually absorb the load you are bringing.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we need to show total supply at the pickup station and total demand at the destination station
 * please, green for in demand, red for not in demand, and yellow for inbetween"
 *
 * ★ RELATIVE TO YOUR HOLD, NOT AN ABSOLUTE ★
 *
 * "4,000 demand" is meaningless on its own. It is generous for a Python and thin for a Cutter, and
 * the same number should not be the same colour for both. So the measure is always "how much of
 * what I am bringing can this place take", which is the question the colour is being asked.
 */

describe('reading market depth', () => {
  it('MANDATORY: enough for the whole load is green', () => {
    expect(depthOf(5_000, 700)).toBe('good');
  });

  it('MANDATORY: nothing at all is red', () => {
    // Zero supply at a pickup means there is nothing to buy; zero demand means nobody is buying.
    expect(depthOf(0, 700)).toBe('none');
  });

  it('MANDATORY: a fraction of the load is amber, not green', () => {
    /*
     * The case the colour exists for. A station wanting 90 tonnes when you are carrying 700 is not
     * a bad stop, but flying there expecting to empty the hold is the mistake — and a green pill
     * would be the tool telling you to make it.
     */
    expect(depthOf(90, 700)).toBe('partial');
  });

  it('MANDATORY: comfortably over the load is green, not merely equal to it', () => {
    /*
     * Exactly enough is fragile: supply and demand are a snapshot, and somebody else docking first
     * takes the margin away. Green means there is room to be second.
     */
    expect(depthOf(700, 700)).toBe('partial');
    expect(depthOf(Math.ceil(700 * DEPTH_COMFORTABLE), 700)).toBe('good');
  });

  it('MANDATORY: an unknown quantity is unknown, never green', () => {
    /*
     * Some sources report no quantity at all. Colouring that green would be the tool inventing
     * confidence it does not have, in the one place a member is deciding where to fly.
     */
    expect(depthOf(null, 700)).toBe('unknown');
  });

  it('MANDATORY: no load to compare against still reads sensibly', () => {
    // The commodity index shows depth with no particular ship in mind.
    expect(depthOf(5_000, 0)).toBe('good');
    expect(depthOf(0, 0)).toBe('none');
  });
});
