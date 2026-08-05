-- Discord DM preferences, one switch per REASON.
--
-- Squadron owner, 2026-07-30: forum posts stay on the website — no Discord channel bridge — but
-- members should be able to opt in to a DM when somebody replies to them, @mentions them, or posts
-- in a thread they pressed "notify me" on.
--
-- ★ WHY THREE COLUMNS AND NOT ONE ★
--
-- The three reasons have very different volumes. Being answered directly is rare and almost always
-- wanted; a busy watched thread can produce twenty messages in an evening. A single switch forces
-- somebody to choose between missing a direct reply and being flooded — and the choice they
-- actually make is to turn everything off, which is how a notification system dies.
--
-- ★ ALL DEFAULT FALSE ★
--
-- Owner chose per-person opt-in. A DM lands in a private inbox, and inferring consent from "they
-- linked Discord to sign in" would be putting words in their mouth — they linked it to
-- authenticate. It also matches the protective defaults D15 set when the squadron confirmed it
-- includes minors.
--
-- notify_forum_dm is CARRIED FORWARD rather than dropped: anybody who had already opted in keeps
-- what they asked for, on the switch that means the same thing. Dropping it would silently turn off
-- a preference somebody had set.
ALTER TABLE "users" ADD COLUMN "notify_dm_direct_reply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "notify_dm_mention"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "notify_dm_watched"      BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "notify_dm_watched" = "notify_forum_dm" WHERE "notify_forum_dm" = true;

ALTER TABLE "users" DROP COLUMN "notify_forum_dm";
