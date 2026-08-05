import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The migration ledger, and whether a deploy would actually work.
 *
 * ★ WHY THIS EXISTS ★
 *
 * On 2026-08-01 `prisma migrate deploy` had been failing for days and nobody knew. One row —
 * `20260801210000_station_market_id_idx` — sat in `_prisma_migrations` with `finished_at` NULL,
 * because the index it creates had been made by hand while diagnosing an EDDN slowdown and the
 * migration was written afterwards. Prisma will not step past a failed migration, so the five
 * behind it never applied either.
 *
 * Nothing broke. The dev database already had every object, so the application worked perfectly and
 * the only symptom was a command nobody runs during normal work. It surfaced when a new migration
 * needed applying and would otherwise have surfaced during a production deploy.
 *
 * These checks are cheap and would have caught it the same afternoon.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../prisma/migrations');

const CONNECTION =
  process.env['DATABASE_URL'] ??
  'postgresql://grims:devpassword@localhost:5432/grimssquad?schema=public';

/** Every migration directory on disk, in the order Prisma applies them. */
function onDisk(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(MIGRATIONS, e.name, 'migration.sql')))
    .map((e) => e.name)
    .sort();
}

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: CONNECTION });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe('the migration ledger', () => {
  it('finds a plausible number of migrations on disk', () => {
    // The check on the check: a glob that silently matched nothing would pass everything below.
    expect(onDisk().length).toBeGreaterThan(50);
  });

  it('MANDATORY: has no migration stuck half-applied', async () => {
    /*
     * The exact state that blocked deploys for days. Prisma refuses to apply anything after a
     * migration it believes failed, and says so only when somebody runs `migrate status` — which is
     * not part of anybody's day.
     *
     * ★ ROLLED BACK IS NOT THE SAME AS FAILED — THE FIRST VERSION OF THIS TEST GOT IT WRONG ★
     *
     * `prisma migrate resolve --applied` does not edit the failed row. It marks that row
     * `rolled_back_at` and INSERTS a fresh finished one, so a correctly resolved migration leaves
     * two rows behind forever. Asserting "no rolled-back rows" therefore fails on every migration
     * anybody has ever fixed — it would have gone red the moment it was made green.
     *
     * The blocking state is narrower: a row that is neither finished NOR rolled back. That is a
     * migration Prisma still believes is in flight, and it is the one that stops a deploy.
     *
     * If this fails: check whether the migration's objects already exist. If they do,
     * `prisma migrate resolve --applied <name>`. If they do not, `--rolled-back` and fix the SQL.
     */
    const { rows } = await db.query<{ migration_name: string }>(
      `select migration_name
         from _prisma_migrations
        where finished_at is null and rolled_back_at is null`,
    );

    expect(rows.map((r) => r.migration_name)).toEqual([]);
  });

  it('leaves nothing rolled back without a successful retry', async () => {
    // The other half of the pair above: a migration marked rolled back and then never re-applied
    // is silently missing, and `migrate status` counts it as pending rather than as broken.
    const { rows } = await db.query<{ migration_name: string }>(
      `select migration_name
         from _prisma_migrations
        group by migration_name
       having bool_or(finished_at is not null) = false`,
    );

    expect(rows.map((r) => r.migration_name), 'rolled back and never retried').toEqual([]);
  });

  it('MANDATORY: has applied every migration that exists on disk', async () => {
    /*
     * Catches the other half: a migration written, committed, and never applied here. That is not a
     * problem for the developer who wrote it — their database already has the change, which is
     * usually WHY they wrote it — and it is a problem for everybody else and for production.
     */
    const { rows } = await db.query<{ migration_name: string }>(
      `select migration_name from _prisma_migrations where finished_at is not null`,
    );

    const applied = new Set(rows.map((r) => r.migration_name));
    const missing = onDisk().filter((name) => !applied.has(name));

    expect(missing, 'migrations on disk that this database has never applied').toEqual([]);
  });

  it('records nothing that does not exist on disk', async () => {
    /*
     * A migration deleted or renamed after being applied. Prisma treats the ledger as the record of
     * what ran, so a name in the database with no directory behind it means the history cannot be
     * replayed — and replaying it is exactly what a fresh environment does.
     */
    const { rows } = await db.query<{ migration_name: string }>(
      `select migration_name from _prisma_migrations`,
    );

    const present = new Set(onDisk());
    const orphans = rows.map((r) => r.migration_name).filter((name) => !present.has(name));

    expect(orphans, 'recorded migrations with no directory').toEqual([]);
  });
});
