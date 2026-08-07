-- Recruitment: a personal invite, and credit for the ones who stay.
--
-- ★ SQUADRON OWNER, 2026-08-06 ★
--
-- "a unique discord invite link for all members that are inara veriefied in our platform! we want
-- this to be a leaderboard item and gamified too please! ... please build me a cool recruit
-- tracking system!"

-- ────────────────────────────────────────────────────── 1. the link itself
--
-- One per member, ever. Re-minting returns the same code rather than littering the guild with
-- abandoned invites — Discord keeps every one until it is deleted, and a member who clicks the
-- button twice should not create a second door.
CREATE TABLE IF NOT EXISTS "recruit_invites" (
  "user_id"     UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  -- Discord's own invite code. Unique because it IS the identity of the link.
  "code"        TEXT NOT NULL UNIQUE,
  -- The last use count we saw. Attribution is a diff against this, so it is state, not a statistic.
  "uses_seen"   INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Revoked rather than deleted: the joins already credited through it must keep their provenance.
  "revoked_at"  TIMESTAMPTZ,
  "revoked_by"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "revoke_reason" TEXT
);

-- ────────────────────────────────────────────────────── 2. who came in
--
-- ★ ONE DISCORD ACCOUNT IS ATTRIBUTABLE ONCE, EVER ★
--
-- The primary key is the joiner's Discord id, not a serial. Leaving and rejoining therefore cannot
-- credit anybody a second time, and it cannot be done by accident — the database refuses it rather
-- than relying on a worker to remember.
CREATE TABLE IF NOT EXISTS "recruit_joins" (
  "discord_id"   TEXT PRIMARY KEY,
  -- Null when we could not tell who to credit. See `attribution` below — this is a normal state,
  -- not a failure, and the recruiting manager can assign it by hand.
  "recruiter_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "invite_code"  TEXT,
  -- auto | manual | ambiguous | unknown. Recorded because "we could not tell" and "an officer
  -- decided" are different facts about the same row, and only one of them should be trusted later.
  "attribution"  TEXT NOT NULL DEFAULT 'unknown',
  "joined_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when the joiner links a hub account, which is what makes the later milestones knowable.
  "user_id"      UUID REFERENCES "users"("id") ON DELETE SET NULL,
  -- Voided rather than deleted, so a fraudulent credit leaves a trail. Points already banked are
  -- reversed by the manager deliberately; this flag stops any FURTHER milestone paying.
  "voided_at"    TIMESTAMPTZ,
  "voided_by"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "void_reason"  TEXT
);

-- "my recruits, newest first" — the member's own tracker, and the only way this is read for them.
CREATE INDEX IF NOT EXISTS "recruit_joins_recruiter_idx"
  ON "recruit_joins" ("recruiter_id", "joined_at" DESC);

-- The unattributed queue the recruiting manager works through.
CREATE INDEX IF NOT EXISTS "recruit_joins_unattributed_idx"
  ON "recruit_joins" ("joined_at" DESC)
  WHERE "recruiter_id" IS NULL;

-- ────────────────────────────────────────────────────── 3. how far they got
--
-- Separate from the join so the tracker can show a ladder rather than a boolean, and so a milestone
-- reached is a fact with a date rather than a derived guess.
CREATE TABLE IF NOT EXISTS "recruit_milestones" (
  "id"          BIGSERIAL PRIMARY KEY,
  "discord_id"  TEXT NOT NULL REFERENCES "recruit_joins"("discord_id") ON DELETE CASCADE,
  -- joined | stayed | verified | flying | cadet. Text rather than an enum: the ladder is a product
  -- decision that may grow, and an enum migration to add a rung locks a table everyone reads.
  "milestone"   TEXT NOT NULL,
  "reached_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- What it paid at the time. Stored rather than recomputed, so tuning the ladder later cannot
  -- silently rewrite what somebody already earned.
  "points"      INTEGER NOT NULL DEFAULT 0,
  -- Each rung once per recruit. This is what makes the worker replayable: a rerun writes nothing.
  CONSTRAINT "recruit_milestones_once" UNIQUE ("discord_id", "milestone")
);

CREATE INDEX IF NOT EXISTS "recruit_milestones_recruit_idx"
  ON "recruit_milestones" ("discord_id", "reached_at");
