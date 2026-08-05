-- Feature Requests: members reply, nobody types a thread. Hand-written (ADR-020).
--
-- ★ THE OWNER'S RULING, 2026-08-04 ★
--
-- "dont allow anyone to start a new thread in the Feature requests category! they must be
-- published via the webmaster approval only! people can reply to the thread like a normal forum
-- but can not start it that way!"
--
-- The seed gated creation AND replies on one mask (post_perm = SITE_CONFIG), which made the
-- board read-only to the very members it asks to vote. Two columns split the two acts:
--
--   reply_perm           the mask required to REPLY in an existing thread. NULL means "same as
--                        post_perm" — exactly what every board did before this column existed,
--                        so a board that never sets it (Announcements included) behaves
--                        identically to before.
--   threads_via_publish  threads on this board arrive ONLY through the suggestion-box publish
--                        flow. The normal composer refuses every caller, the webmaster
--                        included. Default false: every other board is untouched.

ALTER TABLE "forum_categories" ADD COLUMN "reply_perm" NUMERIC(40,0);
ALTER TABLE "forum_categories" ADD COLUMN "threads_via_publish" BOOLEAN NOT NULL DEFAULT false;

-- ── The Feature Requests board wears both ────────────────────────────────────
--
--   reply_perm = 8  FORUM_POST_MEMBER (bit 3) — the members' forum-posting bit, the same one
--                   General demands. A member who can post on the general board can reply here.
--   threads_via_publish = true — the composer door closes; publish is the only creator.
--
-- post_perm stays SITE_CONFIG: it still names who PUBLISHES (the inbox and the board cannot
-- drift to different tiers), and it is the fallback reply gate on every board whose reply_perm
-- is NULL.
UPDATE forum_categories
SET reply_perm = 8::numeric(40,0),
    threads_via_publish = true
WHERE slug = 'feature-requests';
