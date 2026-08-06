import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The market flatten's index definitions.
 *
 * ★ WHY THIS FILE EXISTS AT ALL ★
 *
 * The rebuild drops every index, bulk-loads twenty-seven million rows, and recreates them — which
 * is several times faster than maintaining five indexes per row, and is the difference between a
 * nightly job that finishes and one that is still running at breakfast on a single vCPU.
 *
 * The cost is that the definitions live in TWO places: here in the job, and in the migration that
 * first created them. Two copies drift, and this drift would be SILENT — the rebuild would
 * faithfully recreate an outdated index, every route query would get slower, and nothing anywhere
 * would fail.
 *
 * So the drift is made loud. If somebody adds an index to the migration and not to the job, this
 * test says so.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '../../../../packages/db/prisma/migrations');

/**
 * Every index any migration creates on market_entries.
 *
 * ★ ALL MIGRATIONS, NOT ONE — CHANGED 2026-08-06 ★
 *
 * This used to read a single file, the one that first created the table. Then the outage of
 * 2026-08-06 added `market_entries_buy_coords_idx` in a later migration, and the drift check went
 * quietly blind to it: the job could have dropped that index on every nightly rebuild and never
 * recreated it, and the only symptom would have been "the colonisation page got slow again".
 *
 * A check that only looks where the problem used to be is not a check.
 */
function indexesInMigration(): string[] {
  const found = new Set<string>();
  for (const dir of readdirSync(MIGRATIONS_DIR)) {
    const file = join(MIGRATIONS_DIR, dir, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    for (const m of sql.matchAll(/CREATE INDEX(?:\s+IF NOT EXISTS)?\s+"(market_entries_[a-z_]+)"/gi)) {
      found.add(m[1] ?? '');
    }
  }
  return [...found].sort();
}

/** Every index the job drops and rebuilds. Read from the source, not imported — see below. */
function indexesInJob(): string[] {
  /*
   * Read as TEXT rather than importing the array.
   *
   * Importing would test that the constant equals itself: the same list feeds both the drop and
   * the create, so a typo in one place would be consistent with itself and the test would pass.
   * Reading the file catches a name that appears in DROP but not in CREATE.
   */
  const src = readFileSync(join(import.meta.dirname, 'market-flatten.ts'), 'utf8');

  const dropped = [...src.matchAll(/^\s*'(market_entries_[a-z_]+)',$/gim)].map((m) => m[1] ?? '');
  const created = [...src.matchAll(/CREATE INDEX "(market_entries_[a-z_]+)"/g)].map((m) => m[1] ?? '');

  expect(dropped.sort()).toEqual(created.sort());
  return created.sort();
}

describe('the rebuild recreates exactly what the migration created', () => {
  it('MANDATORY: drops and rebuilds every index the migration defines', () => {
    /*
     * ★ THE FAILURE THIS CATCHES ★
     *
     * An index added to the migration but not here would exist on a freshly-migrated database and
     * vanish the first time the nightly rebuild ran. Route-finding would then do sequential scans
     * over twenty-seven million rows, and the only symptom would be "the trade page got slow".
     */
    expect(indexesInJob()).toEqual(indexesInMigration());
  });

  it('rebuilds all seven, and the trigram index is one of them', () => {
    // Named explicitly: the GIN trigram index is the most expensive to maintain per row and the
    // single biggest reason the drop-and-rebuild shape is worth its complexity.
    const job = indexesInJob();
    expect(job).toHaveLength(7);
    expect(job).toContain('market_entries_commodity_trgm_idx');
  });
});

describe('the planner is told the table is no longer empty', () => {
  /*
   * ★ THE 600-FOLD LIE — MEASURED IN PRODUCTION, 2026-08-06 ★
   *
   * Postgres believed `market_entries` held 30,281 rows. It held 18,847,651. Every plan touching
   * the largest table in the database was costed from a number six hundred times too small, and
   * `pg_stat_user_tables` reported `last_analyze = never` and `last_autoanalyze = never`.
   *
   * The consequence was not subtle. At a real commander's position, "cheapest source of this
   * commodity within 100 ly" took SEVENTY TO ONE HUNDRED AND FIFTEEN SECONDS and returned nothing:
   * the planner chose a KNN walk over the coords index with `commodity` as a post-filter, so it
   * crawled outward through the galaxy discarding rows. The colonisation page fires one of those
   * per commodity, the companion app retried, and the API's whole connection pool was consumed by
   * a single endpoint until the site fell over.
   *
   * ★ AND THE JOB ALREADY HAD AN `ANALYZE` IN IT ★
   *
   * That is the part worth writing down. `rebuildMarketEntries` ran `ANALYZE market_entries` — but
   * INSIDE the same transaction as the TRUNCATE. The planner statistics land transactionally; the
   * cumulative counters in `pg_stat_user_tables` do not work that way, and after a TRUNCATE and a
   * rolled-back or timed-out rebuild they are left describing a table that no longer exists.
   *
   * An ANALYZE that runs where nobody can observe its effect is indistinguishable from no ANALYZE
   * at all, which is precisely how this survived being written down as done.
   *
   * So it now runs AFTER the transaction commits, against the committed table.
   */
  const src = readFileSync(join(import.meta.dirname, 'market-flatten.ts'), 'utf8');

  it('MANDATORY: ANALYZE runs after the transaction commits, not inside it', () => {
    const closingBrace = src.indexOf('{ timeout: 4 * 60 * 60_000');
    expect(closingBrace, 'the transaction options moved — this test is reading the wrong file').toBeGreaterThan(0);

    const afterCommit = src.slice(closingBrace);
    expect(
      afterCommit,
      'no ANALYZE runs after the transaction commits — the planner keeps whatever statistics the TRUNCATE left behind',
    ).toMatch(/ANALYZE market_entries/i);
  });

  it('MANDATORY: it uses the pooled client, not the transaction client', () => {
    /*
     * `tx.$executeRawUnsafe` after the transaction has committed is a use-after-free: Prisma's
     * interactive transaction client is invalid outside its callback. It must be `db`.
     */
    const closingBrace = src.indexOf('{ timeout: 4 * 60 * 60_000');
    const afterCommit = src.slice(closingBrace);
    const analyzeCall = /(\w+)\.\$executeRawUnsafe\(\s*[`'"]ANALYZE market_entries/i.exec(afterCommit);

    expect(analyzeCall?.[1], 'the post-commit ANALYZE is not issued through a client this test recognises').toBeDefined();
    expect(
      analyzeCall?.[1],
      'the post-commit ANALYZE uses the transaction client, which is invalid once the transaction has ended',
    ).not.toBe('tx');
  });
});
