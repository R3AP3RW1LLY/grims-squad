import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

const MIGRATION = join(
  import.meta.dirname,
  '../../../../packages/db/prisma/migrations/20260801100000_market_entries/migration.sql',
);

/** Every index the migration creates on market_entries. */
function indexesInMigration(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  return [...sql.matchAll(/CREATE INDEX\s+"([a-z_]+)"/gi)].map((m) => m[1] ?? '').sort();
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

  it('rebuilds all five, and the trigram index is one of them', () => {
    // Named explicitly: the GIN trigram index is the most expensive to maintain per row and the
    // single biggest reason the drop-and-rebuild shape is worth its complexity.
    const job = indexesInJob();
    expect(job).toHaveLength(5);
    expect(job).toContain('market_entries_commodity_trgm_idx');
  });
});
