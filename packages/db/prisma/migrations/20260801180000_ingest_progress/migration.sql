-- Live progress for running ingests (P2).
--
-- ★ SQUADRON OWNER, 2026-08-01 ★
--
-- "its stuck on estimating.. it should be much more accurate than that!"
--
-- It was, and for two reasons that both come back to this table carrying too little.
--
-- ★ WHY started_at ALONE COULD NOT ANSWER "IS THIS ALIVE" ★
--
-- A run was called stalled once it had been unfinished for six hours. Six hours is an eternity for
-- a page whose whole job is saying what is happening right now — a crashed import sat there
-- claiming "Training now" for the rest of the working day, which is exactly what the owner was
-- looking at.
--
-- The window was that generous because started_at is the only thing it had. With no evidence of
-- work, "slow" and "dead" are the same reading, so the threshold has to clear the slowest possible
-- job.
--
-- `progress_at` removes the guess. A living job touches it every batch, so a run that has written
-- nothing for fifteen minutes is dead — regardless of whether it started ten minutes or ten hours
-- ago. Precise instead of cautious.
ALTER TABLE "knowledge_ingests"
  ADD COLUMN "progress_at" TIMESTAMPTZ;

-- ★ ROWS DEFAULTS TO ZERO, NOT NULL ★
--
-- A run began with rows NULL, and NULL is indistinguishable from "no progress reported yet" —
-- which is why the countdown rendered "estimating…" and stayed there. Zero is a real answer: it
-- means started and nothing written, which is true for a second or two and then stops being true.
ALTER TABLE "knowledge_ingests"
  ALTER COLUMN "rows" SET DEFAULT 0;

-- Existing unfinished rows get a progress stamp of their start, so the stall rule can judge them
-- on the same basis as everything after this. Anything genuinely abandoned is then immediately
-- older than the window and reports itself, rather than lingering as "Training now".
UPDATE "knowledge_ingests" SET "progress_at" = "started_at" WHERE "finished_at" IS NULL;

-- The training page's only query against this table: the newest unfinished run per source.
CREATE INDEX "knowledge_ingests_running_idx"
  ON "knowledge_ingests" ("source", "started_at" DESC)
  WHERE "finished_at" IS NULL;
