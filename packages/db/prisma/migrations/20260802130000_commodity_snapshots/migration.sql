-- One hour of the galaxy's trade in one commodity: the series behind "price over time".
--
-- ★ WHY NOT `market_history` — SQUADRON OWNER, 2026-08-02 ★
--
-- "a real time commodities market ... average pricing, price over time lots of data", and asked how
-- to handle charts when the hypertable had never been written to, the owner chose to start
-- recording now and let them fill.
--
-- Recording every price is not an option, and the number is why. EDDN delivers ~140,000 prices per
-- fifteen-minute window: 13.4 MILLION rows a day, ~1.2 BILLION inside `market_history`'s ninety-day
-- retention. Compression does not rescue that, and nothing on any page would ever read a
-- per-station series for 239,265 stations.
--
-- Rolled up per commodity per hour it is 398 rows an hour — 9,552 a day, under four million a year
-- — and it answers what was actually asked: what is this worth across the bubble, and which way is
-- it moving. `market_history` keeps its definition for the day per-station series earn their cost.
CREATE TABLE "commodity_snapshots" (
  "commodity"   TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,

  -- Repeated on every row on purpose. The market index page groups and filters by category, and the
  -- alternative is a join to an 18.8-million-row table with no index that supports it. A category
  -- never changes; 398 short strings an hour is not a cost worth normalising away.
  "category"    TEXT,

  -- ── stations, carriers excluded ───────────────────────────────────────────
  --
  -- ★ SEPARATED BECAUSE ONE MEAN WOULD DESCRIBE NOWHERE ★
  --
  -- Carrier owners set prices by hand. In our own data the cheapest Gold in the galaxy is a set of
  -- carriers at 2,356 against a station average of 48,098 — not an error, and not somewhere a
  -- member can be sent, because the carrier will have jumped. Averaged together the figure
  -- describes neither.
  --
  -- NULL rather than 0 when nowhere traded it this hour. Zero is a price; "nobody stocked it" is
  -- not, and a chart that plots the second as the first shows a crash that never happened.
  "avg_buy"      INTEGER,
  "min_buy"      INTEGER,
  "avg_sell"     INTEGER,
  "max_sell"     INTEGER,
  "supply"       BIGINT  NOT NULL DEFAULT 0,
  "demand"       BIGINT  NOT NULL DEFAULT 0,
  -- How many markets each average is over. A price from three markets and a price from three
  -- thousand are not the same claim, and a chart that will not say which is one that misleads.
  "buy_markets"  INTEGER NOT NULL DEFAULT 0,
  "sell_markets" INTEGER NOT NULL DEFAULT 0,

  -- ── carriers, kept beside rather than blended in ──────────────────────────
  "carrier_min_buy"  INTEGER,
  "carrier_max_sell" INTEGER,
  "carrier_markets"  INTEGER NOT NULL DEFAULT 0,

  -- Composite: the natural key, and the index every chart reads. One commodity's whole series is
  -- one range scan on the leading column.
  CONSTRAINT "commodity_snapshots_pkey" PRIMARY KEY ("commodity", "observed_at")
);

-- "what did the whole market look like at this hour" — the movers table on the index page, which
-- compares the newest hour against an earlier one across every commodity at once.
CREATE INDEX "commodity_snapshots_observed_at_idx"
  ON "commodity_snapshots" ("observed_at");
