-- Member-owned system groups, for the nexus.
--
-- ★ SQUADRON OWNER, 2026-08-24 ★
--
-- "we need a way to allow members who have multiple systems in their colonization to create a nexus
-- that will predict trade routes". Asked how a member's own group should behave, the answer was to
-- mirror shared plans exactly: private by default with a Share control, and names unique per owner
-- so two members can both call one "Colonia Core".
--
-- ★ THE SAME TWO COLUMNS AS ColonyPlan, ANSWERING THE SAME TWO QUESTIONS ★
--
-- `owner` decides who may EDIT. `visibility` decides who may SEE. Keeping them apart is what lets
-- `mayEdit` stay a question about ownership alone -- the identical reasoning written down in
-- 20260824233000_plan_visibility, and the reason a shared group never becomes an editable one.
--
-- ★ NO BACKFILL IS NEEDED, AND THAT IS A FACT NOT AN ASSUMPTION ★
--
-- Checked against production before writing this: colony_blocs holds 0 rows and colony_bloc_systems
-- holds 0. The feature has existed and never been used, so there is nothing to reclassify and no
-- risk of hiding an existing squadron grouping behind a `private` default.
--
-- Had there been rows, they would all have been officer-created squadron groupings and would have
-- needed owner='squadron', visibility='squadron' -- because defaulting them to private would have
-- made every existing bloc vanish for everybody but its author. Written down because the next
-- person to add a column here will face the same question with a table that is no longer empty.
--
-- ★ THE NAME CONSTRAINT CHANGES SHAPE ★
--
-- colony_blocs_name_key was UNIQUE(name) across the whole table, which was reasonable while only
-- officers could create one. With member-owned groups it would mean the first member to use a name
-- takes it from the squadron -- and the refusal would be about a row they cannot see, which is the
-- least explicable error a member can be given.
--
-- Dropped and replaced with UNIQUE(created_by_id, name). Safe on an empty table: no rows to
-- conflict, and the index build is instant. On a populated one this would be the risky line in the
-- file, which is exactly why the count above was checked rather than assumed.
--
-- No CONCURRENTLY: it cannot run inside the transaction a migration runs in, and on an empty table
-- there is nothing to build concurrently. No maintenance_work_mem cap for the same reason -- nothing
-- here sorts.
ALTER TABLE "colony_blocs"
  ADD COLUMN "owner" "ColonyOwner" NOT NULL DEFAULT 'personal',
  ADD COLUMN "visibility" "ColonyVisibility" NOT NULL DEFAULT 'private';

DROP INDEX IF EXISTS "colony_blocs_name_key";

CREATE UNIQUE INDEX "colony_blocs_created_by_id_name_key"
  ON "colony_blocs" ("created_by_id", "name");

CREATE INDEX "colony_blocs_visibility_idx" ON "colony_blocs" ("visibility");
