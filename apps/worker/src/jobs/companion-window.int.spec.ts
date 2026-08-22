import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@grims/db';
import { closeCompanionWindow, companionWindowStore } from './companion-window.js';

/**
 * The reporting window against real Postgres.
 *
 * ★ WHY THE UNIT TESTS ARE NOT ENOUGH ★
 *
 * `companion-window.spec.ts` mocks the store, so it proves the LOGIC decides correctly — quiet
 * windows still close, gaps are measured from the last window — and proves nothing whatsoever about
 * the three hand-written queries underneath it.
 *
 * Those queries are the part that can fail: a column that does not exist, a timestamptz compared
 * against a JS Date, an INSERT missing a NOT NULL. None of it typechecks. It would ship green and
 * then fail every fifteen minutes inside `closeCompanionWindow`'s catch, where the only symptom is
 * a training page that still says "Never run" — the exact bug this was written to fix, surviving
 * its own fix in silence.
 *
 * ★ AND IT WRITES REAL ROWS, SO IT CLEANS UP AFTER ITSELF ★
 *
 * `knowledge_ingests` is what the training page reads. A test row left behind would show up there
 * as a completed window that never happened.
 */

const db = new PrismaClient();

describe('the companion window, against real Postgres', () => {
  it(
    '★ MANDATORY: the three queries actually run ★',
    async () => {
      const store = companionWindowStore(db);
      const now = new Date();

      /*
       * Each one separately, so a failure names which query is wrong rather than just "the window
       * did not close". closeCompanionWindow swallows errors by design, which would otherwise make
       * this test pass while everything underneath it was broken.
       */
      const previous = await store.lastWindowEnd();
      expect(previous === null || previous instanceof Date).toBe(true);

      const from = new Date(now.getTime() - 60_000);
      const count = await store.countSince(from, now);
      expect(Number.isFinite(count), 'the count comes back as a number').toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);

      await store.writeWindow({ startedAt: from, finishedAt: now, rows: count });

      const [written] = await db.$queryRawUnsafe<
        Array<{ rows: number | null; finished_at: Date | null; started_at: Date }>
      >(
        `SELECT rows, finished_at, started_at FROM knowledge_ingests
          WHERE source = 'companion' ORDER BY started_at DESC LIMIT 1`,
      );

      expect(written, 'a row reached the table the training page reads').toBeDefined();
      expect(written?.finished_at, 'and it is CLOSED — an open row reads as a stall').not.toBeNull();
      expect(Number(written?.rows)).toBe(count);

      // Remove only what this test wrote. The page must not show a window that never happened.
      await db.$executeRawUnsafe(
        `DELETE FROM knowledge_ingests WHERE source = 'companion' AND started_at = $1`,
        from,
      );

      await db.$disconnect();
    },
    60_000,
  );

  it(
    'a full close writes exactly one window',
    async () => {
      /*
       * The whole path, as the daemon calls it. Guards the wiring between the logic and the queries
       * — each half can be right while the join between them is not.
       */
      const before = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM knowledge_ingests WHERE source = 'companion'`,
      );

      const store = companionWindowStore(db);
      await closeCompanionWindow(store, new Date());

      const after = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM knowledge_ingests WHERE source = 'companion'`,
      );

      expect(
        Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0),
        'exactly one window, not zero and not two',
      ).toBe(1);

      await db.$executeRawUnsafe(
        `DELETE FROM knowledge_ingests
          WHERE id = (SELECT id FROM knowledge_ingests WHERE source = 'companion'
                       ORDER BY started_at DESC LIMIT 1)`,
      );

      await db.$disconnect();
    },
    60_000,
  );
});
