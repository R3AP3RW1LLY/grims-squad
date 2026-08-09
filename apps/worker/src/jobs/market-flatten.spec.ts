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

describe('the live table is never locked for the length of the rebuild', () => {
  /*
   * ★ THE OUTAGE OF 2026-08-09 — FORTY MINUTES, EVERY NIGHT A DUMP LANDED ★
   *
   * The rebuild used to run in place: TRUNCATE, drop the indexes, reload eighteen million rows,
   * recreate them, all inside one transaction. TRUNCATE takes ACCESS EXCLUSIVE and Postgres holds a
   * lock until COMMIT, so the table members read was unreachable for the whole rebuild — 40m 20s
   * measured, of which 24.8 minutes was the INSERT and 15.7 the index builds.
   *
   * What made it a SITE outage rather than a market outage is the connection pool. Every request
   * touching market_entries queued on the lock while holding one of twenty-five connections; the
   * pool was fully consumed 52 seconds in, and from then on requests reading `device_pairings` or
   * `sessions` failed too. 1,486 pool timeouts, stopping dead at the commit.
   *
   * ★ WHY THESE ASSERTIONS AND NOT A TIMING TEST ★
   *
   * The defect is not "slow". It is "holds an exclusive lock on the table members read while doing
   * something slow", and that is a property of WHICH TABLE the expensive statements name — which
   * source text can check and a test against a seeded database cannot, because at fixture scale the
   * whole rebuild finishes before anything could observe the lock.
   */
  const src = readFileSync(join(import.meta.dirname, 'market-flatten.ts'), 'utf8');

  /** The statements that take ACCESS EXCLUSIVE, and must therefore never name the live table. */
  const EXCLUSIVE = [/TRUNCATE\s+TABLE\s+market_entries\b/i, /DROP\s+INDEX[^\n]*market_entries/i];

  it('★ MANDATORY: nothing truncates or drops an index on the live table ★', () => {
    for (const pattern of EXCLUSIVE) {
      expect(
        src,
        `a statement matching ${pattern} names the live table. Anything taking ACCESS EXCLUSIVE on ` +
          'market_entries holds it until COMMIT, and every request touching the table then queues ' +
          'on it holding a pool connection until the pool is gone and the whole site is down.',
      ).not.toMatch(pattern);
    }
  });

  it('★ MANDATORY: the bulk load and the index builds target the shadow table ★', () => {
    const insert = /INSERT INTO \$\{SHADOW\}/.test(src);
    expect(insert, 'the bulk INSERT does not target the shadow table').toBe(true);

    // Every CREATE INDEX is issued through onShadow(), which retargets and renames it. A raw
    // CREATE INDEX would build on the live table and take a lock for the length of the build.
    expect(src, 'an index is created without going through onShadow()').toMatch(
      /\$executeRawUnsafe\(onShadow\(ddl\)\)/,
    );
  });

  it('MANDATORY: the swap does only catalogue work', () => {
    /*
     * The swap is the one place the live table IS exclusively locked, so what happens inside it is
     * the thing that decides whether that lock lasts milliseconds or minutes. Renames are catalogue
     * updates; anything that reads or writes rows is not.
     */
    const start = src.indexOf('ALTER TABLE market_entries RENAME TO');
    expect(start, 'the swap has moved — this test is reading the wrong file').toBeGreaterThan(0);

    const swap = src.slice(src.lastIndexOf('await db.$transaction(', start), start + 1200);
    for (const forbidden of [/INSERT INTO/i, /\bDELETE FROM/i, /\bUPDATE\s+market/i, /CREATE INDEX/i]) {
      expect(swap, `the swap transaction contains ${forbidden}, which is not catalogue work`).not.toMatch(
        forbidden,
      );
    }
  });

  it('MANDATORY: live rows are merged both before the swap and after it', () => {
    /*
     * Twice, and both are load-bearing. The first pass carries the ~905,000 live rows into the
     * shadow before the indexes are built. The second carries whatever the feeds wrote during the
     * index phase — sixteen minutes on 2026-08-09 — out of the retired table before it is dropped.
     * Without the second, every rebuild would silently discard the last quarter-hour of live market
     * data, which is a quieter version of the massacre the merge was written to stop.
     */
    const merges = [...src.matchAll(/mergeLiveRows\((?!from)/g)];
    expect(
      merges.length,
      'the live-row merge does not run exactly twice — once into the shadow, once out of the retired table',
    ).toBe(2);

    expect(src).toMatch(/mergeLiveRows\('market_entries', SHADOW\)/);
    expect(src).toMatch(/mergeLiveRows\(RETIRED, 'market_entries'\)/);
  });

  it('MANDATORY: a shrunken dump is refused rather than published', () => {
    // Building beside the live table means the result can be inspected before it is adopted. A
    // truncated download must not be able to replace eighteen million rows with a handful.
    expect(src).toMatch(/MIN_ACCEPTABLE_FRACTION/);
    expect(src, 'a refused rebuild must leave the live table alone by dropping the shadow').toMatch(
      /DROP TABLE IF EXISTS \$\{SHADOW\}[\s\S]{0,400}throw new Error/,
    );
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

  it('★ MANDATORY: ANALYZE runs on the shadow, before it becomes the live table ★', () => {
    /*
     * ★ WHY THIS MOVED, 2026-08-09 ★
     *
     * The old shape had to run ANALYZE after the transaction committed, because inside it the
     * counters were describing a table the TRUNCATE had replaced. Building beside the live table
     * removes the trap entirely: the shadow is analysed while it is still private, so the instant
     * it becomes `market_entries` it already carries statistics. There is no window in which the
     * live table is both queryable and unanalysed — which is what the old ordering could only
     * approximate.
     */
    const analyze = src.indexOf('ANALYZE ${SHADOW}');
    expect(analyze, 'nothing analyses the shadow table').toBeGreaterThan(0);

    const swap = src.indexOf('ALTER TABLE market_entries RENAME TO');
    expect(swap, 'the swap has moved — this test is reading the wrong file').toBeGreaterThan(0);
    expect(
      analyze,
      'the ANALYZE runs after the swap, so the table is live and unanalysed in between — which is ' +
        'how a 600-fold underestimate made route queries take 70-115 seconds on 2026-08-06',
    ).toBeLessThan(swap);
  });

  it('MANDATORY: it uses the pooled client, not a transaction client', () => {
    /*
     * `tx.$executeRawUnsafe` outside its callback is a use-after-free: Prisma's interactive
     * transaction client is invalid the moment the callback returns. The ANALYZE stands alone
     * between two transactions and must be issued on `db`.
     */
    const analyzeCall = /(\w+)\.\$executeRawUnsafe\(\s*[`'"]ANALYZE \$\{SHADOW\}/i.exec(src);

    expect(analyzeCall?.[1], 'the ANALYZE is not issued through a client this test recognises').toBeDefined();
    expect(analyzeCall?.[1], 'the ANALYZE uses a transaction client').not.toBe('tx');
  });
});
