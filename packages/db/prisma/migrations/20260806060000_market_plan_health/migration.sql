-- The three database facts that made the site fall over on 2026-08-06, recorded so a rebuilt
-- database has them from the first minute rather than after the first outage.
--
-- ★ WHAT HAPPENED ★
--
-- Postgres believed `market_entries` held 30,281 rows. It held 18,847,651. Every plan touching the
-- largest table in the database was costed from a number six hundred times too small, and
-- `pg_stat_user_tables` reported `last_analyze = never` AND `last_autoanalyze = never`.
--
-- At a real commander's position, "cheapest source of this commodity within 100 ly" took SEVENTY
-- TO ONE HUNDRED AND FIFTEEN SECONDS and returned nothing. The colonisation page fires one of
-- those per commodity in the build; the companion app retried; the API's whole connection pool
-- went to that one route and the site stopped answering.
--
-- Everything below was applied by hand to production during the incident. This file is what makes
-- it true of any database created from these migrations.

-- ────────────────────────────────────────────────────────────── 1. the index that fixed it
--
-- ★ WHY A COMPOSITE, AND WHY GiST ★
--
-- The query is `WHERE commodity = $1 ... ORDER BY coords <-> origin LIMIT 1`. With only a GiST
-- index on `coords`, Postgres walks outward from the origin nearest-first and applies `commodity`
-- as a FILTER — so when nothing within range sells that commodity, it crawls the galaxy to prove
-- it. That is the seventy-second query, and its answer is an empty set.
--
-- btree_gist lets a scalar equality column share a GiST index with the cube, so the KNN walk is
-- scoped to one commodity before it starts.
--
-- Measured on production, same six build commodities at a real origin:
--   before   88.8s   72.9s   71.3s   0.12s   76.2s   70.4s
--   after     0.27s   0.43s   0.02s  0.26s    0.15s   0.19s
--
-- ★ PARTIAL, BECAUSE THE FULL TABLE IS FOUR TIMES THE SIZE ★
--
-- 5,520,326 rows carry supply AND a buy price; 18,918,978 rows exist. Indexing only what can
-- actually be bought keeps this at 708 MB instead of several gigabytes, and every query that uses
-- it already carries those predicates.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- IF NOT EXISTS because production already has it: it was built with CREATE INDEX CONCURRENTLY
-- during the incident, deliberately, so the site was not locked for the duration of the build.
-- A migration cannot use CONCURRENTLY (it cannot run inside a transaction), so on a fresh database
-- this takes the lock — which is correct there, because a fresh database has no members on it.
CREATE INDEX IF NOT EXISTS "market_entries_buy_coords_idx"
  ON "market_entries" USING gist ("commodity", "coords")
  WHERE "supply" > 0 AND "buy_price" > 0 AND "coords" IS NOT NULL;

-- ────────────────────────────────────────────────────────────── 2. autovacuum that actually runs
--
-- ★ THE DEFAULTS ARE A PERCENTAGE, AND A PERCENTAGE OF EIGHTEEN MILLION IS ENORMOUS ★
--
-- Postgres autovacuums a table after roughly 20% of it changes. On 18.8M rows that is 3.7 million
-- dead tuples before anything happens — and autoanalyze at 10% is 1.9 million changes before the
-- statistics are refreshed. Neither had ever triggered.
--
-- Worse, it is 20% of what the STATISTICS say the table holds. Believing the table held 30,281
-- rows, autovacuum concluded it was far too small to be worth visiting, which is how the wrong row
-- count kept itself wrong.
--
-- Scale factors near zero with an absolute floor turn that percentage into a fixed number of rows,
-- so the trigger no longer depends on the very statistic it exists to correct.
ALTER TABLE "market_entries" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 50000,
  autovacuum_analyze_threshold = 50000,
  -- The default cost limit makes a vacuum of this table take most of a day. The box has twelve
  -- cores and the vacuum is I/O bound; letting it work faster is what makes it finish at all.
  autovacuum_vacuum_cost_limit = 2000
);

-- knowledge_items is 6.6 GB and feeds the RAG embeddings and every station lookup. Same reasoning,
-- gentler numbers: it changes far less often than the market does.
ALTER TABLE "knowledge_items" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 2000
);

-- ────────────────────────────────────────────────────────────── 3. tell the planner the truth now
--
-- Without this, a freshly migrated database starts with the same empty-table statistics that
-- caused the incident, and stays that way until the thresholds above are first crossed.
ANALYZE "market_entries";
