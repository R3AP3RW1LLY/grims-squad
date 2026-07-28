-- Activity per member per DAY. The shape of a month, rather than its total.
--
-- `member_activity_months` holds one row per member per month with a single
-- `last_activity_at`. A daily chart built from that counts each member on the
-- ONE day they were last seen: somebody active on the 5th and the 20th appears
-- only on the 20th, and a busy month renders as a scattering of single marks.
-- The chart looked entirely plausible and was wrong.
--
-- Promotion still reads the MONTHLY table. This is for display and carries no
-- authority — a discrepancy between the two must never change who is promoted.

CREATE TABLE IF NOT EXISTS "member_activity_days" (
  "discord_id"       TEXT NOT NULL,
  -- Midnight UTC, so which day a message counts toward never depends on where
  -- the server happens to be running.
  "day"              DATE NOT NULL,
  "message_count"    INTEGER NOT NULL DEFAULT 0,
  "forum_post_count" INTEGER NOT NULL DEFAULT 0,
  "voice_join_count" INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY ("discord_id", "day")
);

-- The chart reads a month at a time, across every member.
CREATE INDEX IF NOT EXISTS "member_activity_days_day_idx"
  ON "member_activity_days" ("day");
