import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carrierCover, carrierHoldLines } from './colony-carrier.service.js';
import type { AttachedCarrier } from './colony-carrier.service.js';

/**
 * The overlay's carrier column, and the rule it was ignoring.
 *
 * ★ WHAT WAS WRONG — 2026-08-17 ★
 *
 * The in-game overlay built its carrier column straight from `c.holds`, which is only the market
 * MIRROR — a carrier's public sell orders. Cargo staged for a build is exactly the cargo that is NOT
 * on sale; that is the stated reason the journal, cAPI and manual sources exist at all.
 *
 * So the panel a member reads in the seconds before opening a commodity market was blind to three of
 * the four sources, and understated every staged hold. The route never called `carrierCover`, even
 * though the same controller imports it and applies it on the project-detail route two hundred lines
 * above. Same data, same file, two different answers — and the overlay showed the smaller one, which
 * is the one that sends somebody shopping.
 *
 * ★ WHY THE ARITHMETIC IS ASSERTED AND NOT JUST THE CALL SITE ★
 *
 * A third copy of the merge rule was the actual risk here: `carrierCover` had it, `manifest()` had
 * it, and the obvious fix for the overlay is to write it a third time. Every copy is a chance for one
 * surface to disagree with another, which is the bug being fixed. So the numbers are pinned as well
 * as the wiring.
 */

const at = new Date('2026-08-17T00:00:00Z');

const carrier = (
  over: Partial<Pick<AttachedCarrier, 'holds' | 'declared' | 'callsign' | 'name'>>,
): Pick<AttachedCarrier, 'holds' | 'declared' | 'callsign' | 'name'> => ({
  name: 'W8K-W1Y Hauling',
  callsign: 'W8K-W1Y',
  holds: [],
  declared: [],
  ...over,
});

describe('what the overlay is told a carrier holds', () => {
  it('★ MANDATORY: staged cargo the mirror cannot see is counted ★', () => {
    /*
     * The whole defect in one case. The carrier has 800 t of Titanium aboard for the build and none
     * of it on sale, so the mirror reports nothing. The old column showed nothing, and a member
     * flew off to buy 800 t that was already parked at the site.
     */
    const lines = carrierHoldLines([
      carrier({
        holds: [],
        declared: [
          { commodity: 'Titanium', tonnes: 800, source: 'journal', updatedBy: null, updatedAt: at },
        ],
      }),
    ]);

    expect(lines).toEqual([{ commodity: 'Titanium', tonnes: 800, carrier: 'W8K-W1Y' }]);
  });

  it('★ MANDATORY: it agrees with the project page to the tonne ★', () => {
    /*
     * The two surfaces must not disagree about one hold. Asserted against `carrierCover` itself
     * rather than against a number typed here, so the two cannot drift apart without this failing:
     * whatever the page totals, the overlay's lines must sum to.
     */
    const carriers = [
      carrier({
        holds: [{ commodity: 'Steel', tonnes: 500, seenAt: at }],
        declared: [
          { commodity: 'Steel', tonnes: 900, source: 'journal', updatedBy: null, updatedAt: at },
          { commodity: 'Gold', tonnes: 40, source: 'manual', updatedBy: 'RUSTY', updatedAt: at },
        ],
      }),
      carrier({
        callsign: 'K7Q-B4T',
        holds: [{ commodity: 'Steel', tonnes: 200, seenAt: at }],
        declared: [
          { commodity: 'Steel', tonnes: 0, source: 'capi', updatedBy: null, updatedAt: at },
        ],
      }),
    ];

    const cover = carrierCover(carriers);
    const lines = carrierHoldLines(carriers);

    const summed: Record<string, number> = {};
    for (const l of lines) summed[l.commodity] = (summed[l.commodity] ?? 0) + l.tonnes;

    expect(summed, 'the overlay and the project page read one hold two ways').toEqual(cover);
  });

  it('★ MANDATORY: a cAPI zero removes the line rather than shrinking it ★', () => {
    /*
     * Frontier's manifest is complete, so a commodity it omits is gone — recorded as an explicit
     * cAPI zero. On a panel this small the honest rendering of "none aboard" is no row at all;
     * printing "K7Q-B4T · Steel · 0 t" tells a member to fly to an empty hold.
     */
    const lines = carrierHoldLines([
      carrier({
        holds: [{ commodity: 'Steel', tonnes: 20_000, seenAt: at }],
        declared: [
          { commodity: 'Steel', tonnes: 5_000, source: 'journal', updatedBy: null, updatedAt: at },
          { commodity: 'Steel', tonnes: 0, source: 'capi', updatedBy: null, updatedAt: at },
        ],
      }),
    ]);

    expect(lines, 'Frontier says the hold is empty, so there is nothing to draw').toEqual([]);
  });

  it('the crew’s hand still wins on this surface too', () => {
    // The merge rule is the merge rule everywhere. A member who corrected a figure by hand must not
    // find the overlay quoting the machine at them.
    const lines = carrierHoldLines([
      carrier({
        holds: [{ commodity: 'Gold', tonnes: 900, seenAt: at }],
        declared: [
          { commodity: 'Gold', tonnes: 50, source: 'manual', updatedBy: 'RUSTY', updatedAt: at },
        ],
      }),
    ]);

    expect(lines).toEqual([{ commodity: 'Gold', tonnes: 50, carrier: 'W8K-W1Y' }]);
  });
});

describe('the overlay route uses it', () => {
  it('★ MANDATORY: the route no longer flattens c.holds by hand ★', () => {
    /*
     * The positive half. A correct helper nothing calls is the shape of half the defects found in
     * this module today — `fetchCarrier` with no caller, a route computing `canAttach` and not
     * sending it, a page reading a table nobody writes.
     */
    const src = readFileSync(
      join(process.cwd(), 'src/logistics/colony-device.controller.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');

    expect(src).toContain('carrierHolds: carrierHoldLines(carriers)');
    expect(
      src,
      'flattening c.holds by hand is what made the overlay mirror-only',
    ).not.toContain('c.holds.map');
  });
});
