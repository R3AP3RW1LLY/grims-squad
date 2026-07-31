-- One row per station per commodity: the table route-finding needs.
--
-- ★ WHY THIS EXISTS, AND WHAT IT COST TO LEARN ★
--
-- Market data lives in `knowledge_items.data->'market'` as a JSONB array. That is the right shape
-- for "what does this station trade" — one row, one read.
--
-- It is the wrong shape for "where can I buy Platinum cheaply", which has to expand the array on
-- EVERY station and then filter. On 2026-07-31 a four-way self-join over that structure spilled to
-- temp until it exhausted the disk and took the whole Docker engine down. Split leg-by-leg it works;
-- as a member-facing feature answering arbitrary routes, it would not.
--
-- So the array is flattened once, at ingest, into rows that can be indexed.
--
-- ★ DENORMALISED ON PURPOSE ★
--
-- station_name, system_name and coords are copied onto every row rather than joined from
-- knowledge_items. At ~27M rows a join per query is the difference between an index scan and a hash
-- join over the whole table, and route-finding does several of those per request.
--
-- The cost is that a renamed station is stale here until the next ingest. Stations are renamed
-- roughly never, and the ingest rewrites this table wholesale anyway.
CREATE TABLE "market_entries" (
  "id"           BIGSERIAL PRIMARY KEY,
  -- The knowledge_items row this came from, so a caller can fetch pads, services and economy.
  "station_key"  TEXT NOT NULL,
  "station_name" TEXT NOT NULL,
  "system_name"  TEXT NOT NULL,
  "station_type" TEXT,
  -- Copied so a spatial filter needs no join. See the note above.
  "coords"       cube,
  "large_pads"   INTEGER NOT NULL DEFAULT 0,
  "commodity"    TEXT NOT NULL,
  "category"     TEXT,
  -- What the STATION charges to sell to us. 0 means it does not stock it.
  "buy_price"    INTEGER NOT NULL DEFAULT 0,
  -- What the STATION pays us. 0 means it does not want it.
  "sell_price"   INTEGER NOT NULL DEFAULT 0,
  "supply"       INTEGER NOT NULL DEFAULT 0,
  "demand"       INTEGER NOT NULL DEFAULT 0,
  -- When the MARKET was last seen by a player, not when we ingested. A price nobody has reported
  -- for a month must be treated differently from one seen an hour ago.
  "market_seen_at" TIMESTAMPTZ(6)
);

-- ── the two questions route-finding actually asks ───────────────────────────
--
-- Partial indexes, because roughly half of every market is a commodity the station does not trade.
-- Indexing those rows would double the index for entries no query can ever return.

-- "where can I BUY <commodity> cheaply" — supply first, then price ascending.
CREATE INDEX "market_entries_buy_idx"
  ON "market_entries" ("commodity", "buy_price" ASC)
  WHERE "supply" > 0 AND "buy_price" > 0;

-- "where can I SELL <commodity> dearly" — demand first, then price descending.
CREATE INDEX "market_entries_sell_idx"
  ON "market_entries" ("commodity", "sell_price" DESC)
  WHERE "demand" > 0 AND "sell_price" > 0;

-- Spatial: "within N light years of here". GiST on the copied coordinates.
CREATE INDEX "market_entries_coords_idx"
  ON "market_entries" USING gist ("coords")
  WHERE "coords" IS NOT NULL;

-- "what does THIS station trade" — the reverse lookup, for a station page.
CREATE INDEX "market_entries_station_idx" ON "market_entries" ("station_key");

-- Fuzzy commodity names, so "platinium" still finds Platinum.
CREATE INDEX "market_entries_commodity_trgm_idx"
  ON "market_entries" USING gin ("commodity" gin_trgm_ops);
