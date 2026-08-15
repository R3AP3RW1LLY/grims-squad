-- A build the squadron gave up on.
--
-- ★ SQUADRON OWNER, 2026-08-15 ★
--
-- "we also need to allow admins to mark builds as abandoned and not always just as complete.
-- abandond projects should be hidden to all other members except the project owner please. and
-- should appear red."
--
-- Until now a project was complete or it was not. A build that was given up on therefore had two
-- possible endings and both were false:
--
--   leave it open      it sits on the board for ever, asking for materials nobody will haul —
--                      the same cost as the completion bug the owner reported: "causes our members
--                      to go buy materials for a project thats completed".
--   mark it complete   a station that was never finished enters the record the squadron measures
--                      itself by, inflating every total derived from it.
--
-- People chose the second, because closing it was the only button there was.
--
-- ★ WHY NOT A STATUS ENUM REPLACING completed_at ★
--
-- Because both can be true. The ordinary case is a project marked complete and later corrected by
-- an officer who knows it never was — and collapsing the two columns into one state would destroy
-- the fact that somebody had called it finished. `colonyStatusOf` reads abandoned first, so the
-- correction wins where they disagree, without erasing what it corrected.
ALTER TABLE "colony_projects" ADD COLUMN "abandoned_at" TIMESTAMPTZ(6);
ALTER TABLE "colony_projects" ADD COLUMN "abandoned_by_id" UUID;
ALTER TABLE "colony_projects" ADD COLUMN "abandoned_note" TEXT;

-- The board's default view is "in progress", which reads as `abandoned_at IS NULL AND completed_at
-- IS NULL`. Partial on the live rows: a squadron accumulates finished builds for ever and only the
-- open ones are ever listed by default.
CREATE INDEX "colony_projects_live_idx"
    ON "colony_projects" ("created_at" DESC)
 WHERE "abandoned_at" IS NULL AND "completed_at" IS NULL;
