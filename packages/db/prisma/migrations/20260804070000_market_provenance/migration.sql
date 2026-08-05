-- Where each market row came from, which is the precondition for keeping the right one.
--
-- ★ HAND-WRITTEN, LIKE EVERY MIGRATION HERE (ADR-020) ★
--
-- ★ WHY THIS COLUMN EXISTS — MEASURED 2026-08-04 ★
--
-- market_entries has three writers: the EDDN collector (live, continuous), the companion journal
-- path (live, per member), and the Spansh dump flatten (bulk, whose freshest row is over a day old
-- at the moment it lands and whose median station age is 118 days). Nothing recorded which rows
-- came from where — so the flatten could not tell a live observation from its own previous output,
-- and its TRUNCATE destroyed every fresh row on every run:
--
--     EDDN wrote 398,877 market rows between 04:59 and 06:21;
--     after the 06:39 rebuild the table contained ZERO rows from that window.
--
-- With provenance, the rebuild can preserve any live row that is newer than what the dump offers
-- for the same station. Without it there is nothing to prefer BY.
--
-- 'dump' as the default because every existing row IS from the dump semantically — even the ones
-- EDDN wrote will be reconciled on the next rebuild, and claiming they are live without knowing
-- their true freshness relative to the incoming dump would preserve rows this migration cannot
-- vouch for. The live writers stamp their own value from their next write onwards, which on the
-- current feed is minutes away.
--
-- ADD COLUMN with a constant DEFAULT is metadata-only on this Postgres — no table rewrite of the
-- 18.5M rows.
ALTER TABLE "market_entries"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'dump';

-- The flatten's preservation pass asks "which stations have live rows" once per rebuild. Partial,
-- because 'dump' rows are the overwhelming majority and are never looked up by source.
CREATE INDEX "market_entries_live_source_idx" ON "market_entries" ("station_key")
  WHERE "source" <> 'dump';
