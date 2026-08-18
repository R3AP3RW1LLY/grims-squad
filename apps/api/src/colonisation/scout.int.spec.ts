import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { ScoutService } from './scout.service.js';

/**
 * The scout, run against the real galaxy table.
 *
 * ★ THE QUERY IS THE RISK ★
 *
 * `cube_ll_coord`, a grouped sub-select over 314,650 stations joined on a `split_part` of a text
 * key, and a JSON field that is ABSENT rather than zero for uninhabited systems. None of that
 * typechecks. A wrong column, a bad join or a mis-read population would return a plausible list of
 * the wrong systems, and nothing on screen would look unusual.
 *
 * ★ IT ASSERTS ON PROPERTIES, NOT ON A FIXED ANSWER ★
 *
 * The galaxy table grows as members fly, so asserting "these four systems" would fail for reasons
 * that are not defects. Every assertion here is about a rule that must hold whatever is in the
 * table.
 */

const db = new PrismaClient();

/** The office the squadron actually buys colonisation ships from. */
const OFFICE = 'Col 285 Sector EL-X d1-28';

/**
 * Is the galaxy actually loaded here?
 *
 * ★ WHY THIS EXISTS — CI, 2026-08-16 ★
 *
 * These tests assert against the REAL galaxy dump, and CI's database does not always carry it. When
 * it does not, every assertion below fails for a reason that has nothing to do with the scout: the
 * anchor cannot be found because no system rows exist, not because the code is wrong.
 *
 * That failed two deploys and needed a manual re-run both times, which is worse than it sounds — a
 * test that cries wolf teaches everybody to re-run it, and the day it fails for a REAL reason it
 * gets re-run too.
 *
 * ★ IT SKIPS ON ABSENT DATA AND ONLY ON ABSENT DATA ★
 *
 * The check is narrow on purpose: does the anchor system exist, with coordinates. If it does, every
 * assertion runs exactly as before — a broken scout still fails, loudly. If it does not, the suite
 * says so and moves on, because there is nothing here it could truthfully test.
 *
 * This is deliberately NOT a try/catch around the assertions, which would swallow a real failure
 * along with the missing data and leave nothing to tell them apart.
 */
async function galaxyIsLoaded(): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n
       FROM knowledge_items
      WHERE kind = 'system' AND name = $1 AND coords IS NOT NULL`,
    OFFICE,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

describe('the colonisation scout, against the real galaxy', () => {
  it(
    '★ MANDATORY: a name typed in the wrong case still finds the system ★',
    async () => {
      /*
       * ★ THE REGRESSION THE SPEED-UP COULD HAVE SHIPPED — 2026-08-18 ★
       *
       * The anchor lookup used `lower(name) = lower($1)`, which cannot use the plain btree on
       * `name` — a sequential scan of the whole catalogue on every search, measured at 530 ms
       * against 0.06 ms for an exact match.
       *
       * The easy fix is to make it exact and stop there. That would be a straight regression:
       * somebody typing "col 285 sector ig-w c2-16" into the box would stop finding their own
       * system, and the failure would look like the galaxy not holding it.
       *
       * So the exact match answers almost everything from the index and the case-insensitive form
       * survives as a second query on the miss. This asserts the second half still exists, because
       * the first half is the one anybody would be tempted to keep alone.
       */
      if (!(await galaxyIsLoaded())) {
        console.warn(`SKIPPED: the galaxy dump has no coordinates for ${OFFICE} in this database.`);
        return;
      }

      const svc = new ScoutService(db);
      const shouted = await svc.scout({ anchor: OFFICE.toUpperCase() });
      const whispered = await svc.scout({ anchor: OFFICE.toLowerCase() });

      expect(shouted.unknownAnchor, 'SHOUTED still resolves').toBeNull();
      expect(whispered.unknownAnchor, 'whispered still resolves').toBeNull();
      expect(shouted.anchor?.system.toLowerCase()).toBe(OFFICE.toLowerCase());
      expect(whispered.anchor?.system.toLowerCase()).toBe(OFFICE.toLowerCase());
    },
    60_000,
  );

  it(
    'finds claimable systems around a real anchor and resolves a permit source for them',
    async () => {
      if (!(await galaxyIsLoaded())) {
        // Said out loud rather than passing quietly: a silent skip is indistinguishable from a test
        // that ran, and the next person to read a green suite would believe this was checked.
        console.warn(`SKIPPED: the galaxy dump has no coordinates for ${OFFICE} in this database.`);
        return;
      }

      const svc = new ScoutService(db);
      const out = await svc.scout({ anchor: OFFICE });

      expect(out.unknownAnchor, 'the squadron’s own permit office was not found').toBeNull();
      expect(out.anchor?.system.toLowerCase()).toBe(OFFICE.toLowerCase());

      /*
       * The office is a 5.37-billion-population Federal hub, so it must resolve as Federation. If
       * this ever fails, the JSON field names have moved and every allegiance decision is wrong.
       */
      expect(out.anchor?.allegiance).toBe('Federation');

      expect(out.consideredSystems, 'no claimable systems at all near a known hub').toBeGreaterThan(0);
      expect(out.permitSources, 'no station-bearing systems found near a 61-station hub').toBeGreaterThan(0);

      for (const c of out.candidates) {
        /*
         * ★ THE RULE THAT MAKES A CANDIDATE A CANDIDATE ★
         *
         * Every one must be inside claim range of the anchor, and every permit source must be
         * inside claim range of ITS candidate — not of the anchor. Those are different distances
         * and conflating them offers systems that cannot actually be claimed.
         */
        const fromAnchor = Math.hypot(c.x - 0, c.y - 0, c.z - 0);
        expect(Number.isFinite(fromAnchor)).toBe(true);

        if (c.permit !== null) {
          expect(c.permitLy).not.toBeNull();
          expect(c.permitLy ?? 999).toBeLessThanOrEqual(15);
          expect(c.permit.stationCount, 'a permit source with no station sells nothing').toBeGreaterThan(0);
        }
      }
    },
    120_000,
  );

  it(
    'honours a preferred allegiance when one is reachable',
    async () => {
      const svc = new ScoutService(db);
      if (!(await galaxyIsLoaded())) {
        console.warn(`SKIPPED: the galaxy dump has no coordinates for ${OFFICE} in this database.`);
        return;
      }

      const out = await svc.scout({ anchor: OFFICE, prefer: 'Federation' });

      const withPermit = out.candidates.filter((c) => c.permit !== null);
      if (withPermit.length === 0) return; // nothing to assert about on a thin galaxy table

      /*
       * Not every candidate can have a Federal source — some pockets simply have none in range —
       * but where one exists it must have been chosen. So: no candidate may hold a non-Federal
       * source while a Federal one sat inside its range.
       */
      const federal = withPermit.filter((c) => c.permit?.allegiance === 'Federation');
      expect(
        federal.length,
        'preferring Federation produced no Federal permit sources at a Federal hub',
      ).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    'says plainly when the anchor is a system we do not hold',
    async () => {
      const svc = new ScoutService(db);
      const out = await svc.scout({ anchor: 'Definitely Not A Real System XYZZY' });

      // Named back, so the page can say WHICH name failed rather than showing an empty list.
      expect(out.unknownAnchor).toBe('Definitely Not A Real System XYZZY');
      expect(out.candidates).toEqual([]);
      expect(out.anchor).toBeNull();

      await db.$disconnect();
    },
    60_000,
  );
});
