-- What an attached carrier's hold DECLARES it is carrying for a build.
--
-- Hand-written like every migration here (ADR-020): `prisma migrate dev` proposes dropping the
-- pgvector HNSW index, the cube GiST index and the tsvector columns on every run.
--
-- The market mirror sees only a carrier's SELL ORDERS, and cargo staged for a build is exactly the
-- cargo that is usually not on sale. These rows carry the two sources that close the gap: the
-- owner's own journal (source = 'journal', written by the companion app, updated_by_id NULL) and a
-- crew member's hand (source = 'manual', updated_by_id set).
--
-- One row per (carrier, commodity, source), deliberately — a journal update landing two minutes
-- after a member corrected a figure by hand must not undo the correction. The merge rule the
-- shopping maths reads is: manual if declared, else max(journal, mirror supply).
CREATE TABLE "colony_carrier_cargo" (
  "market_id"     BIGINT NOT NULL,
  "commodity"     TEXT NOT NULL,
  "source"        TEXT NOT NULL,
  "tonnes"        INTEGER NOT NULL,
  "updated_by_id" UUID,
  "updated_at"    TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "colony_carrier_cargo_pkey" PRIMARY KEY ("market_id", "commodity", "source")
);

-- "which carriers have declared steel" — the cover roll-up on a project page.
CREATE INDEX "colony_carrier_cargo_commodity_idx" ON "colony_carrier_cargo" ("commodity");
