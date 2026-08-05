-- What economy a finished build pushes a system towards.
--
-- Hand-written like every migration here (ADR-020): `prisma migrate dev` proposes dropping the
-- pgvector HNSW index, the cube GiST index and the tsvector columns on every run.
--
-- `economy_influence` has a default only so the ALTER can fill rows that already exist; the seed
-- replaces every one on the same deploy, and the default is dropped immediately after so a future
-- insert cannot quietly succeed with a value nobody chose.

ALTER TABLE "colony_build_types"
  ADD COLUMN "economy_influence" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "economy_fixed"     TEXT;

ALTER TABLE "colony_build_types" ALTER COLUMN "economy_influence" DROP DEFAULT;
