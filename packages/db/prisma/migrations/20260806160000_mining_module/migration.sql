-- The mining module: Deep Core leaderboard, prospected rocks, and the sessions they belong to.
--
-- ★ SQUADRON OWNER, 2026-08-06 ★
--
-- "our own version of EDminer ... gamified leaderboard ... on refined materials ... must meet /
-- exceed ED tools as it works currently!" — with full rock collection chosen deliberately, so the
-- squadron can answer a question no single-player tool can: which rings are actually paying, this
-- week, measured across everybody.

-- ────────────────────────────────────────────────────── 1. the fourth board's opt-out
--
-- Every leaderboard has one, defaulting ON — the standing rule is that participation is automatic
-- and opted OUT of, never opted in to. The TYPE SYSTEM demanded this the moment 'mining' joined
-- LeaderboardKey: `Record<LeaderboardKey, keyof PrivacySettings>` in the privacy page stopped
-- compiling, which is the schema's own comment working exactly as it was written to.
-- On privacy_settings, NOT users. The first draft of this migration put it on users and the
-- leaderboard integration test caught it immediately: the standings query aliases the table `ps`
-- and failed with "column ps.show_lb_mining does not exist". That test runs every board query
-- against real Postgres for exactly this reason.
ALTER TABLE "privacy_settings" ADD COLUMN IF NOT EXISTS "show_lb_mining" BOOLEAN NOT NULL DEFAULT true;

-- ────────────────────────────────────────────────────── 2. one mining session
--
-- A session is a continuous stretch of mining: it opens on the first prospected rock and closes
-- after a gap. It exists so the member's own history reads as evenings rather than as thousands of
-- individual rocks, and so "yield per hour" has something to divide by.
CREATE TABLE IF NOT EXISTS "mining_sessions" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "started_at"      TIMESTAMPTZ NOT NULL,
  "ended_at"        TIMESTAMPTZ,
  -- Where. Null until a rock or a location event names it; the ring is the interesting unit, and
  -- the body is what a member would recognise.
  "system_name"     TEXT,
  "body_name"       TEXT,
  "ring_name"       TEXT,
  -- What came out. Refined tonnage is the scoring quantity; rocks and hits are the skill measures.
  "tonnes_refined"  INTEGER NOT NULL DEFAULT 0,
  "rocks_prospected" INTEGER NOT NULL DEFAULT 0,
  "rocks_hit"       INTEGER NOT NULL DEFAULT 0,
  "points"          INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "my sessions, newest first" — the only way this table is ever read for a member.
CREATE INDEX IF NOT EXISTS "mining_sessions_user_idx"
  ON "mining_sessions" ("user_id", "started_at" DESC);

-- ────────────────────────────────────────────────────── 3. every rock prospected
--
-- ★ THE HIGHEST-VOLUME TABLE ON THE PLATFORM, DELIBERATELY ★
--
-- `ProspectedAsteroid` fires on every limpet hit: several hundred an hour while somebody is mining,
-- against roughly twenty `MiningRefined`. Collecting it in full was chosen knowingly, because it is
-- the only way to answer "is this ring still paying" from more than one commander's memory.
--
-- Kept narrow for that reason. The percentages that matter and nothing else — no raw payload, no
-- limpet ids, nothing that would make a row wide enough for the volume to hurt.
CREATE TABLE IF NOT EXISTS "prospected_rocks" (
  "id"           BIGSERIAL PRIMARY KEY,
  "session_id"   UUID REFERENCES "mining_sessions"("id") ON DELETE CASCADE,
  "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "at"           TIMESTAMPTZ NOT NULL,
  "system_name"  TEXT,
  "body_name"    TEXT,
  -- The best material on the rock and its share. One row per rock, not per material: the decision
  -- a miner makes is about the best thing on it, and the rest is noise at this volume.
  "top_material" TEXT NOT NULL,
  "top_percent"  DOUBLE PRECISION NOT NULL,
  -- Frontier's own word for the rock's overall richness: Low, Medium, High.
  "content"      TEXT,
  -- A motherlode is the rock a core miner is looking for, and rare enough to be worth its own flag
  -- rather than being inferred from a percentage later.
  "motherlode"   TEXT
);

-- "what has this ring been running lately" — the squadron intelligence query, and the reason the
-- full collection was worth asking for.
CREATE INDEX IF NOT EXISTS "prospected_rocks_ring_idx"
  ON "prospected_rocks" ("system_name", "body_name", "at" DESC);

-- The member's own history, and the motherlode badge sweep.
CREATE INDEX IF NOT EXISTS "prospected_rocks_user_idx"
  ON "prospected_rocks" ("user_id", "at" DESC);

-- ────────────────────────────────────────────────────── 4. the scoring ledger
--
-- Deep Core writes to `leaderboard_events` like colony and trade do, rather than keeping its own
-- ledger the way Data Runners does — there is nothing richer to record than "this member refined
-- this much of this", so a fourth shape would be a fourth thing to read.
--
-- No DDL needed: `leaderboard_events` already carries an arbitrary board key. Recorded here so the
-- next reader does not go looking for a mining_claims table that was deliberately never created.

-- ────────────────────────────────────────────────────── 5. the consent category itself
--
-- ★ CAUGHT BY mining-ingest.int.spec.ts, NOT BY THE COMPILER ★
--
-- `telemetry_events.category` is a Postgres ENUM. MINING 2 added 'mining' to the TypeScript union
-- and to every allowlist, and all of that typechecked green — but without this line the database
-- rejects the value outright, so EVERY rock and every refined tonne the companion sent would have
-- been thrown out at insert with a 22P02. The whole module would have shipped, looked complete,
-- and collected nothing.
--
-- IF NOT EXISTS because ALTER TYPE .. ADD VALUE is not transactional on older servers and this
-- migration must be safe to re-run.
ALTER TYPE "TelemetryCategory" ADD VALUE IF NOT EXISTS 'mining';
