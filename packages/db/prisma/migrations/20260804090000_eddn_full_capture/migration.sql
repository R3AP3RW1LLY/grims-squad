-- Everything else EDDN carries, recorded. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER, 2026-08-04 ★
--
-- "Capture and leverage all information that we can use on our system from EDDN! ... we need to be
-- leveraging EDDN in every aspect of our platform! non-negotiable!" — and, offered the full schema
-- menu, chose all four families: station services, exploration & bodies, carrier tracking, and
-- traffic & routes.
--
-- The collector subscribes to the whole relay and consumed exactly one schema of it (commodity/3,
-- 2.6% of messages by count). These tables are where the other 97.4% lands. Same philosophy as the
-- price history: every day not recorded is data nothing can backfill.

-- ══════════════════════════════ STATION SERVICES ══════════════════════════════
-- outfitting/2 and shipyard/2: what each station SELLS beyond commodities. One row per station,
-- arrays replaced wholesale on every message — the message lists everything current, so a module
-- absent from it is one the station has stopped selling (same replace-don't-merge reasoning as
-- markets). GIN answers "which stations near me sell a 5A FSD".
CREATE TABLE "station_outfitting" (
  "market_id" BIGINT NOT NULL,
  "modules"   TEXT[] NOT NULL,
  "seen_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "station_outfitting_pkey" PRIMARY KEY ("market_id")
);
CREATE INDEX "station_outfitting_modules_idx" ON "station_outfitting" USING GIN ("modules");

CREATE TABLE "station_shipyard" (
  "market_id" BIGINT NOT NULL,
  "ships"     TEXT[] NOT NULL,
  "seen_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "station_shipyard_pkey" PRIMARY KEY ("market_id")
);
CREATE INDEX "station_shipyard_ships_idx" ON "station_shipyard" USING GIN ("ships");

-- ══════════════════════════════ EXPLORATION & BODIES ══════════════════════════════
-- fssbodysignals/1 and journal SAASignalsFound: biological and geological signal counts per body.
-- These are two of the three named blind spots in the colonisation economy model — the buffs the
-- model prints "not taken into account" for today.
CREATE TABLE "body_signals" (
  "system_address" BIGINT NOT NULL,
  "body_id"        INTEGER NOT NULL,
  "body_name"      TEXT,
  "biological"     INTEGER NOT NULL DEFAULT 0,
  "geological"     INTEGER NOT NULL DEFAULT 0,
  "seen_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "body_signals_pkey" PRIMARY KEY ("system_address", "body_id")
);

-- approachsettlement/1: settlements with their body and surface coordinates — the only public
-- source for exactly where a ground settlement is.
CREATE TABLE "settlements" (
  "system_address" BIGINT NOT NULL,
  "name"           TEXT NOT NULL,
  "body_name"      TEXT,
  "market_id"      BIGINT,
  "latitude"       DOUBLE PRECISION,
  "longitude"      DOUBLE PRECISION,
  "seen_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "settlements_pkey" PRIMARY KEY ("system_address", "name")
);
CREATE INDEX "settlements_market_idx" ON "settlements" ("market_id") WHERE "market_id" IS NOT NULL;

-- ══════════════════════════════ CARRIER TRACKING ══════════════════════════════
-- CarrierJump and carrier Docked events: where a fleet carrier actually is, live. Carriers are our
-- stalest data (2x worse than stations) and the only stations that MOVE — this is what lets a page
-- say "this carrier left that system two hours ago, its Steel listing is void".
CREATE TABLE "carrier_positions" (
  "market_id"      BIGINT NOT NULL,
  "callsign"       TEXT NOT NULL,
  "system_name"    TEXT NOT NULL,
  "system_address" BIGINT,
  "event"          TEXT NOT NULL,
  "seen_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "carrier_positions_pkey" PRIMARY KEY ("market_id")
);
CREATE INDEX "carrier_positions_system_idx" ON "carrier_positions" ("system_name");

-- fcmaterials_journal/1: the carrier bartender's buy/sell orders for on-foot materials. Replaced
-- per carrier per message, like every market.
CREATE TABLE "fc_bartender" (
  "market_id" BIGINT NOT NULL,
  "item"      TEXT NOT NULL,
  "price"     INTEGER NOT NULL DEFAULT 0,
  "stock"     INTEGER NOT NULL DEFAULT 0,
  "demand"    INTEGER NOT NULL DEFAULT 0,
  "seen_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "fc_bartender_pkey" PRIMARY KEY ("market_id", "item")
);

-- ══════════════════════════════ TRAFFIC & ROUTES ══════════════════════════════
-- FSDJump (flown) and navroute (planned), rolled up hourly per system. The question this answers
-- is "how busy is this system" — which predicts how fresh its market data will STAY, and later
-- feeds the Data Bounty scoring: a bounty in a system nobody visits is worth more.
CREATE TABLE "system_traffic" (
  "system_address" BIGINT NOT NULL,
  "hour"           TIMESTAMPTZ(6) NOT NULL,
  "jumps"          INTEGER NOT NULL DEFAULT 0,
  "routed"         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "system_traffic_pkey" PRIMARY KEY ("system_address", "hour")
);

-- ══════════════════════════════ EVERYTHING ELSE ══════════════════════════════
-- Arrival counts per schema per hour, so "record everything" is literally true even for the
-- schemas with no feature yet (codexentry, navbeaconscan, dockinggranted...) — and so the day one
-- of them earns a table, we know its real volume before designing it.
CREATE TABLE "eddn_schema_stats" (
  "schema"   TEXT NOT NULL,
  "hour"     TIMESTAMPTZ(6) NOT NULL,
  "messages" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "eddn_schema_stats_pkey" PRIMARY KEY ("schema", "hour")
);
