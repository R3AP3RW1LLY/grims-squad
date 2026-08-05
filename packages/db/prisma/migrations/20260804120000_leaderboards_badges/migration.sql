-- Leaderboards, XP and badges. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER, 2026-08-04 ★
--
-- "make a new category called leaderboards ... gamify the colonization leaderboard, make badges
-- ect the same way were doing it for databounties ... then we also need to make a leaderboard and
-- gamify it for Trade routes make this work like the other ones too ... default all leaderboard
-- participation on for all commanders please!"
--
-- Badge RULES live in code (@grims/shared/leaderboards); these tables hold only the data: points
-- earned, badges awarded, the member's declared current build, and scorer cursors.

-- One point-earning deed on a gamified board ('colony' | 'trade'; bounties keeps bounty_claims).
CREATE TABLE "leaderboard_events" (
  "id"          BIGSERIAL NOT NULL,
  "user_id"     UUID NOT NULL,
  "board"       TEXT NOT NULL,
  "points"      INTEGER NOT NULL,
  "source_key"  TEXT NOT NULL,
  "meta"        JSONB,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "leaderboard_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leaderboard_events_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "leaderboard_events_board_source_key_key"
  ON "leaderboard_events" ("board", "source_key");
CREATE INDEX "leaderboard_events_board_occurred_at_idx"
  ON "leaderboard_events" ("board", "occurred_at");
CREATE INDEX "leaderboard_events_user_id_board_occurred_at_idx"
  ON "leaderboard_events" ("user_id", "board", "occurred_at");

-- A badge a member has earned. Awards only — what badges EXIST is code.
CREATE TABLE "user_badges" (
  "user_id"    UUID NOT NULL,
  "badge_key"  TEXT NOT NULL,
  "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_badges_pkey" PRIMARY KEY ("user_id", "badge_key"),
  CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The build a member is currently on — at most one, which is what "current" means.
CREATE TABLE "current_builds" (
  "user_id"    UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "set_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "current_builds_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "current_builds_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "current_builds_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "colony_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "current_builds_project_id_idx" ON "current_builds" ("project_id");

-- A scorer's high-water mark. One generic table, not one per job.
CREATE TABLE "worker_cursors" (
  "key"        TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "worker_cursors_pkey" PRIMARY KEY ("key")
);

-- Per-board participation, under the existing master switch. Default ON per the owner's blanket
-- instruction; every one remains a switch a member can turn off in Commander Management.
ALTER TABLE "privacy_settings" ADD COLUMN "show_lb_bounties" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "privacy_settings" ADD COLUMN "show_lb_colony"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "privacy_settings" ADD COLUMN "show_lb_trade"    BOOLEAN NOT NULL DEFAULT true;
