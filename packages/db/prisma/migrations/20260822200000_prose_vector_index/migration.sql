-- A search index for PROSE ONLY, so a member's question cannot be answered with star systems.
--
-- ★ MEASURED IN PRODUCTION, 2026-08-22 ★
--
-- "how do I become a member of the squadron" returned five system names. The joining guide was
-- sitting at cosine distance 0.2183; the shared HNSW index handed back rows at 0.3904.
--
-- Nothing was corrupt. An exact scan found the guide first, every time. The cause is arithmetic:
-- 302 prose rows were competing with 687,000 systems and stations inside ONE approximate index,
-- heading for 1.6 million, and approximate search is entitled to lose 302 needles in that haystack.
--
-- ★ WHY A PARTIAL INDEX AND NOT A BIGGER ef_search ★
--
-- Tuning was tried and measured. ef_search 40 -> 800 improved the answers and never reached the
-- true nearest row, at four times the latency (31ms -> 121ms). It is a knob that has to be kept
-- ahead of a corpus that grows every hour, and one day it would not be.
--
-- This index holds ~302 rows. It is 1.2 MB and answers in 9.6ms with EXACT results, because there
-- is nothing in it to get lost among. The galaxy import can add ten million systems and this index
-- will not notice.
--
-- ★ THE PREDICATE MUST MATCH THE QUERY, LITERALLY ★
--
-- KnowledgeService.semantic writes kind NOT IN ('system', 'station', ...) as a literal list built
-- from PLACE_KINDS. Written as a bound parameter instead -- the same condition -- Postgres cannot
-- prove the query is covered by this index, falls back to the shared one, filters every candidate
-- away and returns ZERO ROWS in 11ms. That was measured too, before it shipped.
--
-- prose-not-places.spec.ts holds this list and PLACE_KINDS to the same four values.
--
-- ★ WHY A PLAIN CREATE AND NOT CONCURRENTLY ★
--
-- The same reason 20260810200000_market_id_lookup gives, and this migration was written with
-- CONCURRENTLY first and had to be corrected: CONCURRENTLY cannot run inside the transaction a
-- migration runs in, so the whole migration fails and every later one is skipped.
--
-- The lock is affordable here. This is a PARTIAL index whose predicate excludes the four kinds that
-- make up 99.96% of the table, so the build touches ~302 rows; on production the equivalent
-- concurrent build took 7.2 seconds, and a plain build does one scan rather than two.
--
-- IF NOT EXISTS because production already has this index -- it was created by hand, concurrently,
-- to restore the assistant before this migration existed. There it is a no-op; on a fresh database
-- it is the real thing.
-- ★ AND WHY THE MEMORY IS CAPPED — LEARNED TWICE NOW ★
--
-- Without this, the build asks for the server's maintenance_work_mem (2 GB) and dies with
-- "could not resize shared memory segment ... No space left on device" on any database whose
-- /dev/shm is smaller than that. Production raised shm_size to 3 GB in August; a developer's
-- machine and CI did not, so the migration would fail everywhere except the one place it was
-- tested. apps/worker/src/jobs/embed-knowledge.ts carries the same scar and the same fix.
--
-- SET LOCAL works here precisely because a migration DOES run in a transaction -- the same fact
-- that rules CONCURRENTLY out. 64 MB is ample: the index covers ~302 rows.
SET LOCAL maintenance_work_mem = '64MB';

CREATE INDEX IF NOT EXISTS knowledge_items_embedding_prose_idx
  ON knowledge_items USING hnsw (embedding vector_cosine_ops)
  -- m and ef_construction well above the defaults (16/64). On 302 rows the build cost is
  -- irrelevant and the recall is what matters.
  WITH (m = 32, ef_construction = 200)
  WHERE embedding IS NOT NULL
    AND kind NOT IN ('system', 'station', 'visited-system', 'visited-station');
