-- Colonisation: what the squadron is building, and what members have asked for help with.
--
-- ★ SQUADRON OWNER, 2026-08-02 ★
--
-- "colonization ... will allow our members to post their colonization project to the squadron for
-- assistance etc. officers will be able to add Squadron specific and personal project and ladder
-- ranked members will be able to list personal projects ... keep our own full records too."
--
-- ★ FULLY OURS ★
--
-- The original instruction was to integrate with Ravencolonial's API. Shown that it holds nothing
-- we cannot capture ourselves — it learns from the same journal events our companion app already
-- reads — the owner chose self-contained. These tables ARE the record.

CREATE TYPE "ColonyOwner" AS ENUM ('squadron', 'personal');
CREATE TYPE "ColonyVisibility" AS ENUM ('private', 'squadron', 'public');

CREATE TABLE "colony_projects" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner"        "ColonyOwner" NOT NULL,
  -- Kept for squadron projects too: somebody made that call, and "who declared this the effort" is
  -- worth more than a null.
  "posted_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  -- ★ THE JOIN TO REALITY ★
  --
  -- The construction site's market id, from the journal. It is how a ColonisationConstructionDepot
  -- event finds the project a member posted, and it is stable in a way the station name is not.
  "market_id"    BIGINT NOT NULL,

  "system_name"  TEXT NOT NULL,
  "system_id64"  BIGINT,
  "station_name" TEXT,
  "build_type"   TEXT,

  "title"        TEXT NOT NULL,
  "notes"        TEXT,

  "visibility"   "ColonyVisibility" NOT NULL DEFAULT 'squadron',
  "share_token"  TEXT UNIQUE,

  -- More than one may be true at once. A squadron can genuinely be pushing two builds, and a schema
  -- that permits only one would have officers fighting over a flag instead of hauling.
  "is_priority"  BOOLEAN NOT NULL DEFAULT false,

  "completed_at" TIMESTAMPTZ(6),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- One project per construction site. A second post of the same site is the same build, and two rows
-- would split its deliveries between them with neither showing the truth.
CREATE UNIQUE INDEX "colony_projects_market_id_key" ON "colony_projects" ("market_id");
CREATE INDEX "colony_projects_owner_priority_idx" ON "colony_projects" ("owner", "is_priority");
CREATE INDEX "colony_projects_posted_by_idx" ON "colony_projects" ("posted_by_id");

-- What a project still needs.
--
-- ★ REPLACED WHOLE, NEVER DECREMENTED ★
--
-- ColonisationConstructionDepot reports the REMAINING need for every commodity at once. Applying it
-- as a delta would drift the moment one event was missed — and events ARE missed, because a member
-- can haul with the companion app closed. The snapshot is always right; a running total is right
-- only if nothing was ever lost.
CREATE TABLE "colony_needs" (
  "project_id"  UUID NOT NULL REFERENCES "colony_projects"("id") ON DELETE CASCADE,
  "commodity"   TEXT NOT NULL,
  "remaining"   INTEGER NOT NULL,
  "required"    INTEGER,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "colony_needs_pkey" PRIMARY KEY ("project_id", "commodity")
);

-- "who else needs Steel" — the shopping-list join, and the squadron-wide view of demand.
CREATE INDEX "colony_needs_commodity_idx" ON "colony_needs" ("commodity");

-- Who delivered what.
--
-- ★ APPEND-ONLY, SO THE TALLY CANNOT DRIFT ★
--
-- One row per ColonisationContribution event, never updated. The leaderboard is always the sum of
-- what actually happened, and can be recomputed from scratch if anybody ever doubts it.
CREATE TABLE "colony_contributions" (
  "id"           BIGSERIAL PRIMARY KEY,
  "project_id"   UUID NOT NULL REFERENCES "colony_projects"("id") ON DELETE CASCADE,
  -- Null for a delivery we can attribute to no account. SET NULL rather than CASCADE on purpose:
  -- a member leaving does not un-haul the cargo, and deleting their rows would silently reduce a
  -- project's recorded progress below what was actually delivered.
  "user_id"      UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "commodity"    TEXT NOT NULL,
  "amount"       INTEGER NOT NULL,
  "delivered_at" TIMESTAMPTZ(6) NOT NULL,

  -- The idempotency key, same discipline as telemetry_events (INV-017). Journal timestamps have
  -- whole-second resolution, so the commodity and amount have to be in the hash or two deliveries
  -- in the same second collide and one is silently swallowed.
  "event_key"    TEXT NOT NULL UNIQUE
);

CREATE INDEX "colony_contributions_project_idx"
  ON "colony_contributions" ("project_id", "delivered_at");
CREATE INDEX "colony_contributions_user_idx" ON "colony_contributions" ("user_id");
