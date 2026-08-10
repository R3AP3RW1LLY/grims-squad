-- Where a member actually bought a build's materials.
--
-- ★ SQUADRON OWNER, 2026-08-10 ★
--
-- "a way to declare what station a commander purchased various materials from ... so that all
-- materials that have been found and delivered can be easily procurred without having to go hunt
-- them down"
--
-- ★ ONLY THE HAND-TYPED ROWS ARE STORED ★
--
-- The other half of the catalogue already exists in `telemetry_events`: MarketBuy has carried
-- commodity, quantity, price and MarketID since the app shipped, and production holds 1,181 of them
-- across 128 stations. Copying those here would mean a rollup job, a backfill, and two places for
-- one fact to disagree — so the journal half is derived on read and this table holds only what a
-- person typed.
--
-- ★ HAND-WRITTEN, LIKE EVERY MIGRATION HERE ★
--
-- `prisma migrate dev` proposes dropping the pgvector and full-text indexes on every run, because it
-- cannot see DDL Prisma has no type for. A generated migration applied unread would take the
-- assistant's retrieval and the forum's search down together, silently.
CREATE TABLE "colony_purchases" (
  "id"             BIGSERIAL PRIMARY KEY,
  -- The system being BUILT — what the catalogue belongs to. Keyed by name because that is what a
  -- member types and what every other colonisation row already keys on.
  "system_name"    TEXT NOT NULL,
  "commodity"      TEXT NOT NULL,
  -- Free text on purpose: declaring a station we have never catalogued is exactly the case this
  -- exists for, so it must not require a station we already hold.
  "station_name"   TEXT NOT NULL,
  -- The system the STATION is in, which is rarely the one being built. A station name with no
  -- system is a place nobody can navigate to.
  "station_system" TEXT NOT NULL,
  "tonnes"         INTEGER,
  "price"          INTEGER,
  "note"           TEXT,
  "declared_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "declared_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- One row per person per commodity per station: re-declaring UPDATES rather than duplicating, so a
-- member correcting yesterday's figure does not leave both of them on the page.
CREATE UNIQUE INDEX "colony_purchases_unique_idx"
  ON "colony_purchases" ("system_name", "station_name", "commodity", "declared_by_id");

-- The only read this table serves: everything declared for one system, grouped by station.
CREATE INDEX "colony_purchases_system_idx" ON "colony_purchases" ("system_name");
