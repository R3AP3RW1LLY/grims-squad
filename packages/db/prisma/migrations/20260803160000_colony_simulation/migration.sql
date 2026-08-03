-- The colonisation simulation: what the game charges, and what a build grants.
--
-- ★ HAND-WRITTEN, LIKE EVERY MIGRATION HERE (ADR-020) ★
--
-- `prisma migrate dev` proposes dropping the pgvector HNSW index, the cube GiST index and the
-- tsvector columns on every run, because it cannot see DDL it did not write. Generating this one
-- and trimming it is the same work as writing it, with a chance of missing a drop.
--
-- ★ WHY THE DEFAULTS ARE NOT NULLABLE ★
--
-- Zero is the right answer for every one of these, and it is a TRUE answer: a build that grants no
-- points genuinely grants none. A nullable column would mean "we have not filled this in yet",
-- which is a state the seed closes on the same deploy — so it would exist only long enough to be
-- mishandled by a sum somewhere.

ALTER TABLE "colony_build_types"
  ADD COLUMN "build_class"  TEXT    NOT NULL DEFAULT 'unknown',
  ADD COLUMN "needs_tier"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "needs_points" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gives_tier"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gives_points" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requires"     TEXT,
  ADD COLUMN "satisfies"    TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "eff_population"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eff_max_population"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eff_security"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eff_technology"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eff_wealth"              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eff_standard_of_living"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eff_development"         INTEGER NOT NULL DEFAULT 0;

-- The default exists only so the ALTER can add the column to rows that are already there. Prisma
-- has no default for `build_class`, and leaving one in the database would let a future insert
-- quietly succeed with 'unknown' — a build the simulation cannot classify, which is worse than a
-- write that fails loudly. The seed fills every existing row on the same deploy.
ALTER TABLE "colony_build_types" ALTER COLUMN "build_class" DROP DEFAULT;

-- Finding what satisfies a prerequisite is the hot path of the plan checker: for every site in the
-- build order it asks "is there anything in this system that satisfies X". GIN is the index for a
-- containment test against an array column; a btree cannot answer it at all.
CREATE INDEX "colony_build_types_satisfies_idx" ON "colony_build_types" USING GIN ("satisfies");
