-- When a member last looked at a board, for "new posts" indicators on the category cards.
--
-- ★ PER BOARD, NOT PER THREAD ★
--
-- Per-thread read state is what a large forum does, and it costs a row per member per thread. At
-- 107 members and a growing board that becomes the largest table in the schema within a year,
-- written on every page view, to drive a dot on a card.
--
-- Per-board is bounded by members x boards — a few hundred rows forever — and answers the question
-- actually being asked: does this board have anything I have not seen.
--
-- A thread-level unread mark can be added later without moving this. It is a different question
-- with a different cost, and conflating them now would commit to the expensive one before anybody
-- has asked for it.
CREATE TABLE "forum_category_reads" (
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "forum_category_reads_pkey" PRIMARY KEY ("user_id","category_id")
);

-- "What has this member not seen" — the board-list query, run on every visit to /forum.
CREATE INDEX "forum_category_reads_user_id_idx" ON "forum_category_reads"("user_id");

-- Both cascade: a read marker is meaningless without its member or its board, and leaving orphans
-- would mean the indicator silently stops working for a board that was recreated.
ALTER TABLE "forum_category_reads"
  ADD CONSTRAINT "forum_category_reads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forum_category_reads"
  ADD CONSTRAINT "forum_category_reads_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "forum_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
