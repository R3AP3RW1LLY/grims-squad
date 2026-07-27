-- Monthly activity per Discord member. The input to rank progression.
--
-- Keyed on the Discord snowflake rather than users.id: a users row exists only
-- once someone has signed in to the website (1 of 108 guild members today), so
-- keying on the UUID would track one person and silently ignore everyone else.
CREATE TYPE "GameActivityState" AS ENUM ('unknown', 'observed', 'assumed', 'absent', 'unlinked');

CREATE TABLE "member_activity_months" (
  "discord_id"        TEXT NOT NULL,
  "month"             DATE NOT NULL,
  "user_id"           UUID,
  "message_count"     INTEGER NOT NULL DEFAULT 0,
  "first_message_at"  TIMESTAMPTZ(6),
  "last_message_at"   TIMESTAMPTZ(6),
  "game_activity"     "GameActivityState" NOT NULL DEFAULT 'unknown',
  "game_checked_at"   TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "member_activity_months_pkey" PRIMARY KEY ("discord_id", "month")
);

-- The promotion job's access path: "everyone's activity for month X".
CREATE INDEX "member_activity_months_month_idx" ON "member_activity_months"("month");
CREATE INDEX "member_activity_months_user_id_idx" ON "member_activity_months"("user_id");

ALTER TABLE "member_activity_months"
  ADD CONSTRAINT "member_activity_months_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The month column must always be the FIRST of a month, UTC. The promotion
-- engine compares month keys for equality; a row stored mid-month would never
-- match and the member would silently never be promoted.
ALTER TABLE "member_activity_months"
  ADD CONSTRAINT "member_activity_months_month_is_first"
  CHECK (date_trunc('month', "month"::timestamp) = "month"::timestamp);
