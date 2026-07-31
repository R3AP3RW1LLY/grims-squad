-- Votes, experience and badges (P2).
--
-- ★ SQUADRON OWNER, 2026-07-31 ★
--
-- "we also need upvote, downvote and answer buttons like stack overflow, we need to build these
-- out create an xp and badge system and use upvoted and posts that have been checked as the
-- answer to something as a way to train our ai chat system."
--
-- ★ HAND-WRITTEN, LIKE EVERY MIGRATION HERE ★
--
-- `prisma migrate dev` proposes dropping the pgvector HNSW index, the cube GiST indexes and the
-- generated tsvector column on every single diff, because it has no type for any of them. A
-- generated migration applied unread takes the search and the knowledge base down together.

-- ── votes ───────────────────────────────────────────────────────────────────
--
-- A row per vote rather than a counter on the post. A counter cannot answer "have I already voted
-- on this", which every reader needs on every post to draw the buttons — and it cannot be undone,
-- because withdrawing would decrement something the member might never have incremented.
CREATE TABLE "forum_votes" (
  "post_id"    UUID        NOT NULL REFERENCES "forum_posts"("id") ON DELETE CASCADE,
  "user_id"    UUID        NOT NULL REFERENCES "users"("id")       ON DELETE CASCADE,
  -- +1 or -1, and nothing else. Withdrawing deletes the row, so "no opinion" has exactly one
  -- representation instead of two that every query would have to remember to treat alike.
  "value"      INTEGER     NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One member, one post, one vote — enforced HERE, so two browser tabs racing produce a
  -- constraint violation rather than two votes.
  PRIMARY KEY ("post_id", "user_id"),
  CONSTRAINT "forum_votes_value_check" CHECK ("value" IN (1, -1))
);

-- "What have I voted on in this thread" — asked once per thread render, for the whole page.
CREATE INDEX "forum_votes_user_idx" ON "forum_votes" ("user_id", "post_id");

-- ── the denormalised score ───────────────────────────────────────────────────
--
-- Every post in every thread listing shows its score. Deriving it from forum_votes means a
-- correlated aggregate per post per page load, and reading a thread is the one query on this site
-- that must stay fast. Written in the same transaction as the vote, so it cannot drift without a
-- bug that also lost the vote.
ALTER TABLE "forum_posts" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;

-- PARTIAL, deliberately. The overwhelming majority of posts sit at zero forever, and indexing them
-- helps no query — this exists to find the posts good enough to teach the assistant from.
CREATE INDEX "forum_posts_score_idx" ON "forum_posts" ("score" DESC) WHERE "score" > 0;

-- ── experience ──────────────────────────────────────────────────────────────
--
-- A LEDGER, not a balance. An `xp` column that goes up cannot say why a member has 340, cannot be
-- corrected when an award turns out to be wrong, and if anything ever double-awards there is no
-- way to find out — the number is simply larger than it should be, permanently.
CREATE TABLE "xp_events" (
  "id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- A key of XP_AWARDS in the reputation contract.
  "reason"     TEXT        NOT NULL,
  "amount"     INTEGER     NOT NULL,
  -- A post id, a thread id, or a date. Free-form because the subject differs per reason, and a
  -- typed column per reason would be six columns that are null five times out of six.
  "subject"    TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Summing a member's total, which is the only read this table gets.
CREATE INDEX "xp_events_user_idx" ON "xp_events" ("user_id", "created_at" DESC);

-- ★ IDEMPOTENCE, IN THE DATABASE ★
--
-- The daily job awards `playedToday` per member per date. Run twice — which is exactly what a
-- retry, a manual re-run, or an overlapping cron does — it would award twice, and a ledger that
-- double-counts is worse than no ledger because it looks authoritative.
--
-- Partial, because `subject` is null for reasons where the award SHOULD be repeatable: a member
-- can be upvoted many times on many posts, and a unique key over nulls would either block that or
-- (in Postgres's default null semantics) silently not apply at all.
CREATE UNIQUE INDEX "xp_events_once_idx"
  ON "xp_events" ("user_id", "reason", "subject")
  WHERE "subject" IS NOT NULL;

-- ── badges ──────────────────────────────────────────────────────────────────
--
-- Stored rather than recomputed on read, so the DATE is real. A badge whose earned-at is derived
-- at render time says the member earned it today, every day — and "since March" is most of what a
-- badge is worth.
CREATE TABLE "member_badges" (
  "user_id"   UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "badge_key" TEXT        NOT NULL,
  "earned_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY ("user_id", "badge_key")
);
