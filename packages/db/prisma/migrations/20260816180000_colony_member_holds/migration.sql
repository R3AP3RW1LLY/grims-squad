-- What a member is carrying, of what a build they are on still wants.
--
-- ★ SQUADRON OWNER, 2026-08-16 ★
--
-- "materials being added to fleet carriers and in player holds are not registering properly"
--
-- The overlay was always right — it reads Cargo.json on the member's own machine, and reported
-- correctly throughout. The HUB had never received a hold at all: ZERO `Cargo` telemetry rows,
-- against 8,706 ColonisationConstructionDepot readings, because nothing ever sent one. The website's
-- "player holds" column had no data behind it and never had.
--
-- ★ SCOPED, ON THE OWNER'S INSTRUCTION ★
--
-- "only while on a project." The companion sends the whole hold; the server keeps only commodities a
-- live build the member is on still wants. A mining run, a trade loop and mission cargo never land
-- here. The filter is enforced server-side because a rule on a member's machine can be edited.
--
-- ★ REPLACED WHOLESALE, NEVER MERGED ★
--
-- Each push is the whole truth about that hold at that moment. The writer deletes the member's rows
-- first, so selling 480 t down to 180 reads 180, and undocking empty clears them entirely. A merge
-- would leave the larger figure standing with no event that ever corrects it — which is the wasted
-- trip this module keeps producing under other names.
CREATE TABLE "colony_member_holds" (
    "project_id" UUID NOT NULL,
    "user_id"    UUID NOT NULL,
    "commodity"  TEXT NOT NULL,
    "tonnes"     INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "colony_member_holds_pkey" PRIMARY KEY ("project_id", "user_id", "commodity"),
    CONSTRAINT "colony_member_holds_project_fk"
      FOREIGN KEY ("project_id") REFERENCES "colony_projects"("id") ON DELETE CASCADE,
    CONSTRAINT "colony_member_holds_user_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- The project page's read: everything held against THIS build, by everybody on it.
CREATE INDEX "colony_member_holds_project_idx" ON "colony_member_holds" ("project_id");
