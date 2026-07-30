-- AI pre-publication screening, and the call log.
--
-- Squadron owner, 2026-07-30: "the ai must ingest and moderate all posts before they are visible /
-- posted to the forum". So a post carries a screen state and the read path filters on it. Nothing
-- unscreened is visible, INCLUDING to its author -- a member who could see their own held post
-- would assume it had published.
--
-- The default is HELD, deliberately. If screening is somehow skipped by a future code path, the
-- post waits for a human rather than publishing unseen; the safe direction is the default.
CREATE TYPE "ScreenState" AS ENUM ('held', 'clear', 'refused');

ALTER TABLE "forum_posts"
  ADD COLUMN "screen_state" "ScreenState" NOT NULL DEFAULT 'held',
  ADD COLUMN "screen_verdict" JSONB,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "reviewed_by" UUID;

ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The moderation queue is one query: everything waiting, oldest first.
CREATE INDEX "forum_posts_screen_state_created_at_idx" ON "forum_posts"("screen_state", "created_at");

-- * EXISTING POSTS ARE CLEARED, NOT HELD *
--
-- The column defaults to held for anything NEW. Applying that default to the posts already on the
-- forum would hide the entire existing forum behind a review queue nobody asked for, including the
-- joining guides that anonymous visitors read. Everything written before screening existed was
-- published under the rules of its time.
UPDATE "forum_posts" SET "screen_state" = 'clear';

-- Every call to the AI, kept for review.
--
-- Visible to officers AND to the webmaster -- non-negotiable per the owner, since the webmaster is
-- the AI developer and cannot debug a model whose output they cannot see.
CREATE TABLE "ai_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "kind" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "refused_reason" TEXT,
    "took_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- SET NULL: a departed member leaves their calls in the log rather than deleting the evidence of
-- how the assistant was behaving.
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_calls_created_at_idx" ON "ai_calls"("created_at");
CREATE INDEX "ai_calls_kind_created_at_idx" ON "ai_calls"("kind", "created_at");
CREATE INDEX "ai_calls_user_id_created_at_idx" ON "ai_calls"("user_id", "created_at");
