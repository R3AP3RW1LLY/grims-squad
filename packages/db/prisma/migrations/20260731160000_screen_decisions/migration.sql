-- Screening that learns from what moderators decide.
--
-- Squadron owner, 2026-07-31: "can we train the model based on wither a moderator passes a post in
-- review or dismisses it? so that the model can get better over time?"
--
-- ★ HAND-WRITTEN, NOT GENERATED ★
--
-- Prisma has no native type for pgvector, so `prisma migrate diff` emits a migration that DROPS the
-- vector column and its index on every subsequent run. Written by hand, and the column is declared
-- only as a comment in schema.prisma so the generator never sees it to remove it.

CREATE TABLE "screen_decisions" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: deleting a post must not erase the lesson it taught.
  "post_id"       UUID REFERENCES "forum_posts"("id") ON DELETE SET NULL,
  -- Stored rather than joined. A post can be edited or removed, and an example that changes under
  -- you is not an example.
  "text"          TEXT NOT NULL,
  -- What the HUMAN decided. This is the label.
  "should_flag"   BOOLEAN NOT NULL,
  -- What the screener said at the time. Drift measurement ONLY — never a label, or the model would
  -- be learning from itself and any early mistake would compound forever.
  "model_flagged" BOOLEAN NOT NULL,
  -- 'review' (a moderator decided) or 'report' (a member reported a published post).
  "source"        TEXT NOT NULL,
  "decided_by"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at"    TIMESTAMPTZ(6),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- nomic-embed-text. 768 is asserted against EMBED_DIMS in the contract.
  "embedding"     vector(768)
);

CREATE INDEX "screen_decisions_created_at_idx" ON "screen_decisions" ("created_at");
CREATE INDEX "screen_decisions_source_created_at_idx" ON "screen_decisions" ("source", "created_at");

-- HNSW for nearest-neighbour retrieval at screening time.
--
-- Cosine, matching how the similarity floor was measured. This runs on the POST path — a member is
-- waiting — so an index scan is the difference between retrieval being free and being a second.
--
-- Partial: a row with no embedding cannot be retrieved, and indexing nulls only makes the index
-- bigger for no benefit.
CREATE INDEX "screen_decisions_embedding_idx"
  ON "screen_decisions" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;
