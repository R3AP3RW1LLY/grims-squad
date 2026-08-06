/**
 * Whether a station can actually absorb the load you are bringing.
 *
 * ★ SQUADRON OWNER, 2026-08-06 ★
 *
 * "we need to show total supply at the pickup station and total demand at the destination station
 * please, green for in demand, red for not in demand, and yellow for inbetween"
 *
 * ★ RELATIVE TO THE HOLD, NEVER AN ABSOLUTE ★
 *
 * "4,000 demand" means nothing by itself: generous for a Python, thin for a Cutter. The same figure
 * must not be the same colour for both ships, so the measure is always "how much of what I am
 * carrying can this place take" — which is the question the colour is actually being asked.
 *
 * Shared because the website, the app and the trade overlay all show it, and three thresholds that
 * drifted apart would have one surface calling a stop good while another called it thin.
 */

/** The colour a depth figure earns. */
export type MarketDepth = 'good' | 'partial' | 'none' | 'unknown';

/**
 * How much more than the load counts as comfortable.
 *
 * Exactly enough is fragile — supply and demand are a snapshot, and somebody docking before you
 * takes the margin away. Green means there is room to be second.
 */
export const DEPTH_COMFORTABLE = 1.5;

/**
 * Read a supply or demand figure against the tonnage being moved.
 *
 * `quantity` null means the source reported none. That is `unknown` rather than `none`: "nobody is
 * buying" and "we were not told" are different facts, and only one of them should stop a member
 * flying there.
 */
export function depthOf(quantity: number | null | undefined, tonnes: number): MarketDepth {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 'unknown';
  if (quantity <= 0) return 'none';

  // No particular ship in mind — the commodity index. Anything on offer is worth showing as good.
  if (!Number.isFinite(tonnes) || tonnes <= 0) return 'good';

  return quantity >= tonnes * DEPTH_COMFORTABLE ? 'good' : 'partial';
}
