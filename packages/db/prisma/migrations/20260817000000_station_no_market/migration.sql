-- A member's report that a station HAS NO MARKET.
--
-- ★ WHY THIS IS A TABLE AND NOT A DELETE — 2026-08-16 ★
--
-- A market upload clears a bounty by making the data fresh: the half-hourly rebuild reads that
-- freshness and does not re-list the station. A negative report writes NO market data, so a plain
-- DELETE from `data_bounties` would be undone by the very next rebuild. The member would be paid,
-- the bounty would reappear within thirty minutes, and the next member would fly the same wasted
-- trip — which is the failure this whole feature exists to end.
--
-- The record therefore has to outlive the board, and the board builder reads it.
--
-- ★ KEYED ON THE STATION, NOT ON THE REPORT ★
--
-- One station is one fact: either it has a market or it does not. A surrogate id would let two
-- members file two rows about one station and leave the board asking which to believe. `station_key`
-- as the primary key makes a second report an upsert of the first, which is what it actually is.
CREATE TABLE IF NOT EXISTS "station_no_market" (
  "station_key"     TEXT PRIMARY KEY,
  "station_name"    TEXT NOT NULL,
  "system_name"     TEXT NOT NULL,
  "reported_by_id"  UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reported_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- Set when an officer overturns it. The station returns to the board from the next rebuild.
  "cleared_at"      TIMESTAMPTZ(6)
);

-- For the officer review list: "what has been reported lately", newest first.
CREATE INDEX IF NOT EXISTS "station_no_market_reported_at_idx"
  ON "station_no_market" ("reported_at");
