-- What GMSD AI knows about Elite Dangerous.
--
-- ★ HAND-WRITTEN: pgvector AND cube ★
--
-- Prisma has native types for neither, so a generated diff drops both columns and their indexes on
-- every run. Both are declared as comments in schema.prisma so the generator never sees them.

CREATE TABLE "knowledge_items" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"      TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "ext_key"     TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "data"        JSONB NOT NULL,
  "text"        TEXT,
  "embedding"   vector(768),
  -- 3D galactic position. `cube` is already enabled and is what answers "nearest station with a
  -- large pad" — a question embeddings would answer badly and SQL answers exactly.
  "coords"      cube,
  "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Re-ingesting must UPDATE, not duplicate. Spansh rebuilds nightly and the galaxy would double in
-- size every day without this.
CREATE UNIQUE INDEX "knowledge_items_source_kind_ext_key_key"
  ON "knowledge_items" ("source", "kind", "ext_key");

CREATE INDEX "knowledge_items_source_kind_idx" ON "knowledge_items" ("source", "kind");

-- Exact name lookup, which answers most questions on its own.
CREATE INDEX "knowledge_items_name_idx" ON "knowledge_items" ("name");

-- Fuzzy name matching, for "Shinrata Dezra" and other things members actually type.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "knowledge_items_name_trgm_idx"
  ON "knowledge_items" USING gin ("name" gin_trgm_ops);

-- Prose only. Partial, because the overwhelming majority of rows are structured and have no
-- embedding — indexing their nulls would bloat the index for nothing.
CREATE INDEX "knowledge_items_embedding_idx"
  ON "knowledge_items" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

-- Spatial. GiST, not HNSW: cube is a geometric type and this serves "within N light years".
CREATE INDEX "knowledge_items_coords_idx"
  ON "knowledge_items" USING gist ("coords")
  WHERE "coords" IS NOT NULL;

-- Ingestion history, including failures. A source that is quietly broken must not look identical to
-- one that has simply never run.
CREATE TABLE "knowledge_ingests" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"      TEXT NOT NULL,
  "started_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at" TIMESTAMPTZ(6),
  "rows"        INTEGER,
  "error"       TEXT
);

CREATE INDEX "knowledge_ingests_source_started_at_idx"
  ON "knowledge_ingests" ("source", "started_at");
