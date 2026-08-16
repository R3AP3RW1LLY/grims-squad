-- When the squadron was told about a colonisation project.
--
-- ★ EVERY ANNOUNCEMENT EVER SENT SAID "BUILD TYPE NOT IDENTIFIED YET" — 2026-08-15 ★
--
-- Reported by the squadron owner: "we need this to announce with the type of build it is please.
-- even if there is a short delay in this information please. its very important."
--
-- The Discord template has carried the build type since it was written. It has never once had one to
-- print. The announcement fires from the create path, and `build_type_id` is filled in LATER — by
-- the colonisation sync, which fingerprints the project's bill of materials against the catalogue.
-- At the instant we posted, the column was null. Every time, for every project.
--
-- So a hauler reading the channel learned a system name and nothing about what was being built
-- there, which is the entire decision they were being asked to make: a Refinery Hub is ~22,000
-- tonnes and a Satellite Installation is a few hundred.
--
-- ★ WHY THIS COLUMN HAS TO EXIST ★
--
-- The fix is to announce from a SWEEP instead: post once the type is known, or once waiting has
-- stopped being reasonable (30 minutes — twice the sync's cadence).
--
-- `announce()` has no dedup key. It inserts a row into a queue the bot drains, and announcing
-- exactly once has always been a property of the create path being reached exactly once. A sweep
-- runs every few minutes for ever, so that guarantee has to be rebuilt in the data — otherwise the
-- channel receives the same build again and again until somebody notices.
ALTER TABLE "colony_projects" ADD COLUMN "announced_at" TIMESTAMPTZ(6);

-- ★ EVERY EXISTING PROJECT IS BACKFILLED AS ALREADY ANNOUNCED ★
--
-- They were: under the old create-path behaviour, each one posted to the channel the moment it was
-- created. Leaving them null would make the first sweep read them all as never-announced and
-- re-post the entire history of the squadron's builds into Discord in one burst.
--
-- The backfill deliberately uses `created_at` rather than now(). It is the closest thing to true —
-- the old announcement fired within milliseconds of the insert — and a timestamp that claims we
-- announced a June project today would be a fact invented to fill a column.
UPDATE "colony_projects" SET "announced_at" = "created_at" WHERE "announced_at" IS NULL;

-- The sweep's query: unannounced projects, newest first. Partial, because a row is only interesting
-- while it is null — which is a handful of rows at any moment against a table that only grows.
CREATE INDEX "colony_projects_unannounced_idx"
    ON "colony_projects" ("created_at")
 WHERE "announced_at" IS NULL;
