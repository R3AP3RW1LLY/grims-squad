-- Joining a build, taking on a commodity, and offering a carrier to it.
--
-- ★ SQUADRON OWNER, 2026-08-02 ★
--
-- "we also need a way for people to join the project ahead of time, and a way that we can assign
-- people who do join what materials we want them to haul", "we also need a way to add fleet
-- carriers to the project like raven colonial does", and "squadron carriers too".

-- Who has put their name to a build.
--
-- A ROSTER, not a commitment: it says "I intend to help", which is what makes a build plannable
-- before anybody has flown anywhere, and it is the list an officer assigns from.
--
-- Deliberately separate from having delivered something. A member who hauls without joining still
-- appears in the ledger and on every chart — joining is about what is going to happen, and
-- contributions are about what did.
CREATE TABLE "colony_members" (
  "project_id" UUID NOT NULL REFERENCES "colony_projects"("id") ON DELETE CASCADE,
  "user_id"    UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "joined_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "colony_members_pkey" PRIMARY KEY ("project_id", "user_id")
);

CREATE INDEX "colony_members_user_idx" ON "colony_members" ("user_id");

-- Who is bringing what.
--
-- ★ CLAIMED OR ASSIGNED, AND THE DIFFERENCE IS RECORDED ★
--
-- The owner chose both: members may claim freely, AND officers can assign on squadron projects
-- while a project's owner can assign on their own. `assigned_by_id` is what tells the two apart —
-- null means the member took it themselves.
--
-- That matters on screen, because "you claimed this" and "an officer asked you to do this" are
-- different messages, and it matters for deciding who may take it away again.
CREATE TABLE "colony_assignments" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"     UUID NOT NULL REFERENCES "colony_projects"("id") ON DELETE CASCADE,
  "user_id"        UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "commodity"      TEXT NOT NULL,
  -- Null means "this one is mine" with no number attached, which is how most claims happen.
  "tonnes"         INTEGER,
  -- SET NULL rather than CASCADE: an officer leaving does not un-assign the work they handed out,
  -- and deleting the row would silently drop a commodity somebody is actively hauling.
  "assigned_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- One claim per member per commodity. A second is the same intention restated, and two rows would
-- double-count what the build believes is already covered.
CREATE UNIQUE INDEX "colony_assignments_unique"
  ON "colony_assignments" ("project_id", "user_id", "commodity");

-- "who is covering steel" — the question the project page asks per commodity.
CREATE INDEX "colony_assignments_commodity_idx"
  ON "colony_assignments" ("project_id", "commodity");

-- A fleet carrier helping with a build.
--
-- Attached by ANYBODY on the project who owns it, which is the owner's choice: a big build is
-- exactly where somebody offers their carrier to a project that is not theirs.
CREATE TABLE "colony_carriers" (
  "project_id"  UUID NOT NULL REFERENCES "colony_projects"("id") ON DELETE CASCADE,
  -- The carrier's own market id: how its cargo is recognised in the journal.
  "market_id"   BIGINT NOT NULL,
  "name"        TEXT NOT NULL,
  -- The callsign, e.g. K7Q-B4L. What everybody actually calls it.
  "callsign"    TEXT,
  -- Squadron carriers and members' own are answerable to different people, and a board that cannot
  -- tell them apart cannot say whose cargo is whose.
  "is_squadron" BOOLEAN NOT NULL DEFAULT false,
  "added_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "added_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "colony_carriers_pkey" PRIMARY KEY ("project_id", "market_id")
);

CREATE INDEX "colony_carriers_market_idx" ON "colony_carriers" ("market_id");

-- What is actually sitting in a carrier's hold.
--
-- ★ KEYED ON THE CARRIER, NOT ON A PROJECT ★
--
-- A carrier has one hold. Attaching it to two builds must not produce two sets of cargo, so this is
-- a property of the carrier and a project sums whatever its attached carriers are holding.
--
-- ★ AND IT IS A SNAPSHOT, NOT A LEDGER ★
--
-- The same reasoning as colony_needs. The journal reports transfers as DELTAS, and a member can
-- haul with the app closed — so accumulating them drifts permanently from the first one missed.
-- Each reading replaces the commodity's row outright, and `observed_at` lets a page say how old a
-- figure is rather than implying it is current.
CREATE TABLE "carrier_cargo" (
  "market_id"   BIGINT NOT NULL,
  "commodity"   TEXT NOT NULL,
  "tonnes"      INTEGER NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "carrier_cargo_pkey" PRIMARY KEY ("market_id", "commodity")
);

-- "which carriers are holding steel" — the staged-cargo roll-up on a project page.
CREATE INDEX "carrier_cargo_commodity_idx" ON "carrier_cargo" ("commodity");
