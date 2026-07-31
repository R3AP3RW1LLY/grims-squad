import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@grims/db';
import { readCoriolis } from './ingest-coriolis.js';
import { streamGalaxy } from './ingest-galaxy.js';
import { writeBatch, beginIngest, finishIngest, sourceStatus } from './knowledge-writer.js';

/**
 * A REAL import against a REAL database.
 *
 * The writer's unit tests prove the SQL is shaped correctly against a fake. They cannot prove
 * Postgres accepts it — `cube(array[...])`, the jsonb cast and the ON CONFLICT target all live on
 * the far side of a driver, and a wrong one fails only when it runs.
 *
 * Skips without a database, so CI is unaffected.
 */
const CORIOLIS = 'D:/ai/knowledge/coriolis-data-master';
const GALAXY = 'D:/ai/knowledge/galaxy_populated.json.gz';
const live = process.env['DATABASE_URL'] !== undefined && existsSync(CORIOLIS) ? describe : describe.skip;

/**
 * Removes the ingest RUNS this file created.
 *
 * ★ THE TRAINING PAGE READS THIS TABLE, AND THE TEST WAS LYING TO IT ★
 *
 * Reported by the squadron owner: two sources showing "Training now" with nothing running, and a
 * galaxy row count of 6,006 for a source holding 448,676. Both came from here. This test writes
 * REAL `knowledge_ingests` rows against the REAL development database — that is the point of it,
 * and it is why it can prove things a fake cannot — but it never cleaned them up, so every
 * `pnpm test` left an ingest history entry describing a partial import that no job had performed.
 *
 * The knowledge_items are deliberately LEFT: they are correct rows, and deleting them would make
 * this test destructive to a developer's working data. It is only the RUN LOG that is a lie, and
 * only the run log that is removed.
 */
async function forgetRuns(db: PrismaClient, since: Date): Promise<void> {
  await db.$executeRawUnsafe(
    `DELETE FROM knowledge_ingests WHERE started_at >= $1 AND source IN ('coriolis','galaxy')`,
    since,
  );
}

live('real ingest', () => {
  it('writes ships, modules and blueprints, then re-runs without duplicating', async () => {
    const db = new PrismaClient();
    const startedAt = new Date();
    try {
      const rows = readCoriolis(CORIOLIS);
      const id = await beginIngest(db, 'coriolis');
      let written = 0;
      for (let i = 0; i < rows.length; i += 500) written += await writeBatch(db, rows.slice(i, i + 500));
      await finishIngest(db, id, { rows: written });

      const first = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM knowledge_items WHERE source='coriolis'`,
      );
      console.log('  coriolis rows:', Number(first[0]?.n));
      expect(Number(first[0]?.n)).toBeGreaterThan(200);

      // ★ THE POINT: a second run must UPDATE, not duplicate. Spansh rebuilds nightly.
      for (let i = 0; i < rows.length; i += 500) await writeBatch(db, rows.slice(i, i + 500));
      const second = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM knowledge_items WHERE source='coriolis'`,
      );
      expect(Number(second[0]?.n)).toBe(Number(first[0]?.n));
    } finally {
      // See forgetRuns. The rows this wrote are real; the RUN LOG entry is not.
      await forgetRuns(db, startedAt).catch(() => undefined);
      await db.$disconnect();
    }
  }, 180_000);

  it('writes real galaxy systems with usable coordinates', async () => {
    if (!existsSync(GALAXY)) return;
    const db = new PrismaClient();
    const startedAt = new Date();
    try {
      const id = await beginIngest(db, 'galaxy');
      let written = 0;
      await streamGalaxy(GALAXY, async (batch) => {
        written += await writeBatch(db, batch);
        if (written > 6_000) throw new Error('STOP');
      }, 2_000).catch((e: Error) => { if (e.message !== 'STOP') throw e; });
      await finishIngest(db, id, { rows: written });

      // The query the cube index exists for: nearest systems to Sol.
      const near = await db.$queryRawUnsafe<Array<{ name: string; ly: number }>>(
        `SELECT name, round(cube_distance(coords, cube(array[0::float8,0::float8,0::float8]))::numeric,1) AS ly
           FROM knowledge_items
          WHERE source='galaxy' AND kind='system' AND coords IS NOT NULL
          ORDER BY coords <-> cube(array[0::float8,0::float8,0::float8]) LIMIT 3`,
      );
      console.log('  nearest to Sol:', near.map((r) => `${r.name} ${r.ly}ly`).join(', '));
      expect(near.length).toBeGreaterThan(0);
    } finally {
      // See forgetRuns. This test imports a PARTIAL galaxy on purpose — leaving its run in the log
      // told the training page the galaxy source held 6,006 rows when it holds 448,676.
      await forgetRuns(db, startedAt).catch(() => undefined);
      await db.$disconnect();
    }
  }, 300_000);

  it('reports per-source status for the training page', async () => {
    const db = new PrismaClient();
    try {
      const status = await sourceStatus(db);
      console.log('  status:', status.map((s) => `${s.source}=${s.rows}`).join(', '));
      expect(status.length).toBeGreaterThan(0);
    } finally {
      await db.$disconnect();
    }
  }, 60_000);
});
