-- What a build is FOR, inferred from its modules at import.
--
-- ★ SQUADRON OWNER, 2026-08-01 ★
--
-- "add a status bar like we have on the image training page so we know how many ship builds we need
-- for reliable training ... over do it on the requirements".
--
-- A bar needs something to count towards, and "forty builds" is not a target — forty exploration
-- builds teach the assistant nothing about mining. So builds are counted per role.
--
-- Computed at IMPORT rather than on read: classifying needs the module groups, which needs the ship
-- catalogue, and a list endpoint that had to load 47 ships and 970 modules to render five numbers
-- would be slow for no reason. It is also the point at which every fact about the build is present.
--
-- Hand-written, like every migration here (ADR-020).

ALTER TABLE "ship_builds"
  ADD COLUMN IF NOT EXISTS "role" TEXT;

-- The training bars group by exactly this.
CREATE INDEX IF NOT EXISTS "ship_builds_role_idx" ON "ship_builds" ("role");
