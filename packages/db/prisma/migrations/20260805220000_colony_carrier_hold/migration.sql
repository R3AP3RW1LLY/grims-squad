-- How much is aboard a carrier IN TOTAL, from the game rather than from watching.
--
-- ★ SQUADRON OWNER, 2026-08-05 ★
--
-- "carrier hold info is not updating properly in the companion app or the website, we need this
-- investigated and we need this to be way more accurate than it is currently"
--
-- The companion's cargo fold is a WITNESS: it knows what it watched move and nothing else. In
-- production that was exactly ONE commodity row for the squadron's carrier, presented without
-- comment as though it were the whole manifest.
--
-- `CarrierStats.SpaceUsage.Cargo` is the game's own total tonnage aboard — no breakdown, but true.
-- Held beside the witnessed rows it lets a page say "watched 500 t of the 12,400 t aboard" rather
-- than implying those are the same number.
--
-- ★ KEYED ON THE MARKET ID ALONE ★
--
-- `colony_carrier_cargo` is keyed per commodity and this is one fact about the whole hold;
-- `colony_carriers` is keyed (project, market) and a carrier helping three builds appears three
-- times. What a carrier holds has nothing to do with which build it is attached to.
--
-- Hand-written per ADR-020. Additive only: nothing reads this table until the code that writes it
-- ships, so the old containers serving during the swap are unaffected.
CREATE TABLE IF NOT EXISTS "colony_carrier_hold" (
  "market_id"    BIGINT       NOT NULL,
  "total_tonnes" INTEGER      NOT NULL,
  "observed_at"  TIMESTAMPTZ(6) NOT NULL,
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "colony_carrier_hold_pkey" PRIMARY KEY ("market_id")
);
