-- Backfill watermark for the activity recorder.
--
-- Discord snowflakes are monotonic, so storing the highest id already counted
-- makes "process everything after this" exact, at the cost of one row rather
-- than a table containing every message id ever seen.
--
-- Without it, every bot restart re-reads recent history and re-counts the same
-- messages, inflating everyone's activity a little more with each deploy.
CREATE TABLE "bot_checkpoints" (
  "key"        TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "bot_checkpoints_pkey" PRIMARY KEY ("key")
);
