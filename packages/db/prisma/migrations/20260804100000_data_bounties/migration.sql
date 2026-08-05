-- Data Bounties: the board and the ledger. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER, 2026-08-04 ★
--
-- "create a new page under squadrons called Data bounty's and create a list of all stations and
-- systems we need to dock at to shore up market data ... any time something goes stale it should
-- automatically be added to the list, turn this into our first offical Data Runner Leaderboard
-- please! gamify this too" — staleness-weighted points with jackpots, automatic credit on
-- companion upload, monthly seasons plus all-time, squadron space above the galaxy tail.
--
-- Two tables with two lifespans: `data_bounties` is a SNAPSHOT the worker rebuilds every half
-- hour (going stale is how a station gets listed; being observed is how it leaves), while
-- `bounty_claims` is the PERMANENT ledger the leaderboard sums. A claim consumes the board row in
-- the same transaction, so a bounty pays exactly once however many members dock that night.

CREATE TABLE "data_bounties" (
  "station_key"  TEXT NOT NULL,
  "station_name" TEXT NOT NULL,
  "system_name"  TEXT NOT NULL,
  "station_type" TEXT,
  "large_pads"   INTEGER,
  "last_seen_at" TIMESTAMPTZ(6),
  "days_stale"   INTEGER,
  "points"       INTEGER NOT NULL,
  "jackpot"      BOOLEAN NOT NULL DEFAULT false,
  "in_ops"       BOOLEAN NOT NULL,
  "distance_ly"  DOUBLE PRECISION,
  "computed_at"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "data_bounties_pkey" PRIMARY KEY ("station_key")
);
CREATE INDEX "data_bounties_in_ops_points_idx" ON "data_bounties" ("in_ops", "points");

CREATE TABLE "bounty_claims" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL,
  "station_key"  TEXT NOT NULL,
  "station_name" TEXT NOT NULL,
  "system_name"  TEXT NOT NULL,
  "points"       INTEGER NOT NULL,
  "jackpot"      BOOLEAN NOT NULL DEFAULT false,
  "days_stale"   INTEGER,
  "claimed_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "bounty_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bounty_claims_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "bounty_claims_user_id_claimed_at_idx" ON "bounty_claims" ("user_id", "claimed_at");
CREATE INDEX "bounty_claims_claimed_at_idx" ON "bounty_claims" ("claimed_at");
