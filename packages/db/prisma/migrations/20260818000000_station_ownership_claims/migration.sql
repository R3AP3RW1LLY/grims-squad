-- A station the squadron or one of its members owns, for ranking where to buy.
--
-- ★ SQUADRON OWNER, 2026-08-17 ★
--
-- "the buy locations should be accurate based on the following criteria. 1 squadron owned stations,
-- 2. squadron owned members stations, then closest stations to the build project"
--
-- ★ TWO SOURCES, AND BOTH WERE ASKED FOR ★
--
-- Stations we BUILT through colonisation are derivable from `colony_projects.owner` and cannot go
-- stale. This table is the other half: a station we hold but never built here, and an officer's
-- correction when the derived answer is wrong.
--
-- ★ WHY NOT A COLUMN ON knowledge_items ★
--
-- That table is a MIRROR of the galaxy dump and every row in it is rewritten by the importer, so a
-- claim written there would survive until the next import and no longer. The same reasoning that
-- keeps every other colonisation annotation out of it.
CREATE TABLE IF NOT EXISTS "station_ownership_claims" (
  -- The catalogue key, "<systemAddress>/<stationName>" — the identifier the market mirror and the
  -- carrier queries already join on.
  "station_key"   TEXT PRIMARY KEY,
  -- 'squadron' or 'member'. Deliberately TEXT and not an enum: the ranking treats anything it does
  -- not recognise as unowned, so a future third value degrades to "not ours" instead of breaking
  -- the sort or failing a migration.
  "ownership"     TEXT NOT NULL,
  "note"          TEXT,
  "claimed_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "claimed_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- Withdrawn rather than deleted: the row survives as a record of who claimed what and when. A
  -- deleted row loses the argument; a dated one settles it.
  "withdrawn_at"  TIMESTAMPTZ(6)
);

-- The ranking asks "which stations are ours" once per shopping list, not per station.
CREATE INDEX IF NOT EXISTS "station_ownership_claims_ownership_idx"
  ON "station_ownership_claims" ("ownership");
