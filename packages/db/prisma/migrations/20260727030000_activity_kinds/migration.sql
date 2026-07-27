-- Discord activity is more than messages in one channel (human, 2026-07-27):
-- forum posts and replies, and joining an open voice channel, all count.
--
-- Counted by KIND rather than as one total, so the admin dashboard can show HOW
-- someone takes part. A member who only sits in voice is participating
-- differently from one who only posts, and an officer weighing a promotion
-- should be able to see which — even though any of the three satisfies the test.
ALTER TABLE "member_activity_months"
  ADD COLUMN "forum_post_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "voice_join_count" INTEGER NOT NULL DEFAULT 0;

-- Renamed rather than added: these were only ever "first/last time we saw them",
-- and that meaning now spans all three kinds. Keeping a message-specific name
-- for a column that records voice joins would be a lie in the schema.
ALTER TABLE "member_activity_months" RENAME COLUMN "first_message_at" TO "first_activity_at";
ALTER TABLE "member_activity_months" RENAME COLUMN "last_message_at"  TO "last_activity_at";
