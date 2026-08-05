-- Announcements: what the squadron is told, durably. Hand-written (ADR-020).
--
-- ★ SQUADRON OWNER — THE APPROVED PIPELINE ★
--
-- Producers (the deploy script, the promotion runs, the verification confirm paths) write one
-- row per thing worth announcing. Two independent pollers deliver it: the bot posts `content`
-- to the Discord channel its kind maps to, and the API carbon-copies rows carrying a forum half
-- into the forum's Announcements category, then notifies every member through the bell.
--
-- The same doctrine as `ops_alerts`, and for the same reason: an announcement written while the
-- bot is down must survive the outage and post when the bot returns. A row waits in Postgres for
-- as long as delivery takes; a fire-and-forget send would vanish into the exact restart window a
-- deploy announcement is most likely to be written in.
--
-- `content` arrives FINAL — mentions already interpolated as <@id> tokens by the producer,
-- because only the producer knows who the announcement is about. No channel id is stored here or
-- anywhere in code (INV-008): the bot resolves the destination from environment at delivery time.

CREATE TABLE "announcements" (
  "id"              BIGSERIAL NOT NULL,
  -- 'deploy' | 'promotion' | 'member-verified' — decides which channel env the bot posts to.
  "kind"            TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  -- The forum half. Both set = a carbon-copy thread is wanted; both null = channel only.
  "forum_title"     TEXT,
  "forum_body"      TEXT,
  -- Set when the bot has posted to Discord. Null rows are retried on every poll.
  "posted_at"       TIMESTAMPTZ(6),
  -- Set when the API has created the forum thread — before the bell fan-out, so a failed bell
  -- can never cause a second thread.
  "forum_posted_at" TIMESTAMPTZ(6),
  "forum_thread_id" UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- History reads: "what did we announce, per kind, when".
CREATE INDEX "announcements_kind_created_at_idx" ON "announcements" ("kind", "created_at");

-- The bot's queue: undelivered Discord posts, oldest first. Partial, because delivered history
-- dominates the table within a week of the pipeline going live.
CREATE INDEX "announcements_unposted_idx" ON "announcements" ("created_at")
  WHERE "posted_at" IS NULL;

-- The API's queue: forum carbon-copies not yet made. The forum_title predicate keeps
-- channel-only rows (verifications) out of the index entirely.
CREATE INDEX "announcements_forum_unposted_idx" ON "announcements" ("created_at")
  WHERE "forum_posted_at" IS NULL AND "forum_title" IS NOT NULL;
