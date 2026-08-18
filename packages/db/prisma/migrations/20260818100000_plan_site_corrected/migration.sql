-- A plan row that was corrected to match what actually got built, and what it used to say.
--
-- ★ SQUADRON OWNER, 2026-08-12 ★
--
-- At A 1 f the plan asked for an Extraction Settlement — Medium and a Military Settlement — Small.
-- What stands there is an Extraction Settlement — Small and a Military Settlement — Medium: the
-- sizes are swapped, and those are four different catalogue rows with four different bills of
-- materials. Both builds finished months ago and the plan showed neither, because nothing in it
-- intended either structure.
--
-- ★ WHY RECORD THE CORRECTION RATHER THAN JUST MAKING IT ★
--
-- The plan is edited automatically once the site is linked to a project, because the project is
-- what actually stands and the plan is an intention that turned out to be wrong. But an automatic
-- edit to somebody's plan that leaves no trace is indistinguishable from the plan having been wrong
-- all along — anybody who remembers laying it out would find a structure they never chose, with no
-- way to tell whether the platform decided that or they misremembered.
--
-- So the previous build type survives beside the date, and the plan says out loud what it changed.
--
-- ★ NULLABLE, AND NO BACKFILL ★
--
-- Every existing row predates the correction pass and was not corrected, which is exactly what NULL
-- means here. Writing a date onto rows nobody touched would be inventing history to make a column
-- look complete.
ALTER TABLE "colony_plan_sites"
  ADD COLUMN IF NOT EXISTS "corrected_from_build_type_id" TEXT,
  ADD COLUMN IF NOT EXISTS "corrected_at" TIMESTAMPTZ(6);
