-- The other half of the split: a vector index over PLACES, so "somewhere quiet with good mining and
-- a large landing pad" is a question the assistant can actually answer.
--
-- ★ WHY THIS EXISTS AT ALL ★
--
-- On 2026-08-22 an audit found that NOTHING in the codebase queried place embeddings. 687,000
-- systems and stations had been embedded and no code path read them — before the prose/place split
-- their only effect was crowding the 302 prose rows out of the assistant's answers.
--
-- The squadron owner's decision was to build the consumer rather than abandon the data, which is
-- what makes the embeddings worth their disk. This index is that consumer's half of the split.
--
-- ★ THE TEXT IS WHAT MAKES IT WORK ★
--
-- These rows are not bare names. A station reads:
--
--   "Cranston Prospect is a Coriolis Starport in Pegasi Sector XP-W b2-7. It has 5 large landing
--    pads. Economy: Industrial. 482 ls from arrival. Services: ..."
--
-- Economy, pad count, security, government and distance are all in there, which is why a question
-- phrased in none of those words still finds the right places. Measured on the live corpus,
-- "somewhere quiet with good mining and a large landing pad" returns five Extraction-economy
-- settlements at 0.712-0.724 similarity. That is the feature working, not names coinciding.
--
-- ★ SEPARATE FROM PROSE, PERMANENTLY ★
--
-- knowledge_items_embedding_prose_idx holds the ~302 rows a member's questions need. This holds the
-- 687,000+ that a place question needs. Neither can drown the other however far the galaxy import
-- grows, which is the whole point — see 20260822200000_prose_vector_index for what happened when
-- they shared one.
--
-- Plain CREATE INDEX, not CONCURRENTLY: it cannot run inside the transaction a migration runs in.
-- maintenance_work_mem capped for the same reason as its sibling — an HNSW build otherwise asks for
-- the server's 2 GB and dies on any /dev/shm smaller than that, which is every machine except
-- production.
--
-- The memory cap DOES make this build slower on a large corpus. That is the correct trade: a
-- migration that takes longer is survivable, a migration that fails everywhere but production is
-- not.
SET LOCAL maintenance_work_mem = '256MB';

CREATE INDEX IF NOT EXISTS knowledge_items_embedding_place_idx
  ON knowledge_items USING hnsw (embedding vector_cosine_ops)
  WITH (m = 32, ef_construction = 200)
  WHERE embedding IS NOT NULL
    AND kind IN ('system', 'station', 'visited-system', 'visited-station');
