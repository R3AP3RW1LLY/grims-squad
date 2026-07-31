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

live('real ingest', () => {
  it('writes ships, modules and blueprints, then re-runs without duplicating', async () => {
    const db = new PrismaClient();
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
      await db.$disconnect();
    }
  }, 180_000);

  it('writes real galaxy systems with usable coordinates', async () => {
    if (!existsSync(GALAXY)) return;
    const db = new PrismaClient();
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
