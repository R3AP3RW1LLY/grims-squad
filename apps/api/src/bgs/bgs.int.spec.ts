import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { BgsService } from './bgs.service.js';

/**
 * The watchlist and its orders, actually run.
 *
 * ★ THE SAME REASONING AS leaderboards.int.spec.ts ★
 *
 * Every write here is hand-written SQL against tables nothing has ever used: a cast to the
 * `BgsDirective` ENUM, a join from a system NAME to a 64-bit address, an ON CONFLICT that updates
 * rather than ignores. None of it typechecks, and the enum cast in particular fails only at
 * runtime — the exact shape of bug that took the mining module a day to find.
 */

const db = new PrismaClient();
const TAG = 'bgs-int-spec';

async function officer(): Promise<string> {
  const [row] = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (handle, display_name) VALUES ($1, $1)
     ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    TAG,
  );
  return (row as { id: string }).id;
}

async function cleanUp(userId: string): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM bgs_orders WHERE faction_id IN (SELECT id FROM tracked_factions WHERE name LIKE $1)`,
    `${TAG}%`,
  );
  await db.$executeRawUnsafe(`DELETE FROM tracked_factions WHERE name LIKE $1`, `${TAG}%`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);
}

describe('the BGS watchlist, against Postgres', () => {
  it(
    'watches a faction, issues an order, and countermands it',
    async () => {
      const userId = await officer();
      const svc = new BgsService(db);

      try {
        await svc.watch(`${TAG} Lords`, true);

        const watched = await svc.watchlist();
        const mine = watched.find((f) => f.name === `${TAG} Lords`);
        expect(mine, 'the faction was not added').toBeDefined();
        expect(mine?.isOurs, 'the ours flag did not stick').toBe(true);

        /*
         * Re-watching corrects the flag rather than doing nothing. An officer adding a faction that
         * is already there is almost always fixing exactly this, and a silent no-op reads as a
         * broken button.
         */
        await svc.watch(`${TAG} Lords`, false);
        expect((await svc.watchlist()).find((f) => f.name === `${TAG} Lords`)?.isOurs).toBe(false);

        /*
         * The enum cast. `directive` is a Postgres ENUM, and a value it does not know is a 22P02 at
         * runtime with nothing failing earlier — which is precisely how the mining telemetry
         * category was found.
         */
        /*
         * A real system from what we hold. The schema requires one — `system_address` is NOT NULL,
         * which the first run of this test discovered — because influence is per-system and a
         * faction-wide order is not something a member can act on.
         */
        /*
         * From the GALAXY data, not from `systems` — which is empty, and legitimately so: it is a
         * narrow relational table filled lazily as things start pointing at systems. Ordering
         * against a name we hold is exactly what an officer will type.
         */
        const [anySystem] = await db.$queryRawUnsafe<Array<{ name: string }>>(
          `SELECT name FROM knowledge_items
            WHERE kind = 'system' AND coords IS NOT NULL AND source = 'galaxy'
            GROUP BY name, coords HAVING count(*) = 1 LIMIT 1`,
        );
        if (anySystem === undefined) throw new Error('no galaxy systems held — load the dump first');

        await svc.order({
          factionId: mine?.id ?? '',
          stance: 'push',
          systemName: (anySystem as { name: string }).name,
          priority: 1,
          guidance: 'Run missions here this week.',
          setById: userId,
        });

        const withOrder = (await svc.watchlist()).find((f) => f.name === `${TAG} Lords`);
        expect(withOrder?.orders, 'the order was not stored').toHaveLength(1);
        expect(withOrder?.orders[0]?.stance).toBe('push');

        await svc.countermand(withOrder?.orders[0]?.id ?? '');

        const after = (await svc.watchlist()).find((f) => f.name === `${TAG} Lords`);
        expect(after?.orders, 'a countermanded order still reads as standing').toHaveLength(0);
      } finally {
        await cleanUp(userId);
      }
    },
    60_000,
  );

  it(
    'refuses a stance we do not know, and a negative order with no reason',
    async () => {
      const userId = await officer();
      const svc = new BgsService(db);

      try {
        await svc.watch(`${TAG} Rivals`, false);
        const id = (await svc.watchlist()).find((f) => f.name === `${TAG} Rivals`)?.id ?? '';

        // An invented stance must not reach the enum cast — a 22P02 is a 500, not a message.
        await expect(
          svc.order({
            factionId: id,
            stance: 'obliterate',
            systemName: 'Sol',
            priority: 3,
            guidance: 'x',
            setById: userId,
          }),
        ).rejects.toThrow();

        /*
         * "Leave this faction alone" without a reason reads as an arbitrary rule and gets ignored —
         * which is worse than no order, because the officers believe one is in force.
         */
        await expect(
          svc.order({
            factionId: id,
            stance: 'suppress',
            systemName: 'Sol',
            priority: 3,
            guidance: '   ',
            setById: userId,
          }),
        ).rejects.toThrow();
      } finally {
        await cleanUp(userId);
      }
    },
    60_000,
  );

  it(
    'refuses a system it cannot place rather than silently widening the order',
    async () => {
      const userId = await officer();
      const svc = new BgsService(db);

      try {
        await svc.watch(`${TAG} Typo`, false);
        const id = (await svc.watchlist()).find((f) => f.name === `${TAG} Typo`)?.id ?? '';

        /*
         * ★ THE FAILURE THIS PREVENTS ★
         *
         * Sending somebody to the wrong system is worse than telling them we cannot place the one
         * they typed. The schema requires an address, so the only alternatives to refusing are
         * guessing or crashing — and a 500 on a typo is not a message an officer can act on.
         */
        await expect(
          svc.order({
            factionId: id,
            stance: 'push',
            systemName: 'Not A Real System At All XYZ',
            priority: 3,
            guidance: null,
            setById: userId,
          }),
        ).rejects.toThrow();
      } finally {
        await cleanUp(userId);
        await db.$disconnect();
      }
    },
    60_000,
  );
});
