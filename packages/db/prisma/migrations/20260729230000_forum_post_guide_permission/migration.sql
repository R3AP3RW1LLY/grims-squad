-- FORUM_POST_GUIDE (bit 7, value 128) — authoring the site's own documentation.
--
-- Squadron owner, 2026-07-29, across two instructions: "only the webmaster can author the joining
-- guide", then — on being told SITE_CONFIG also covers galactic_admiral and prime_legate —
-- "widen to officers too".
--
-- ★ WHY A NEW BIT AND NOT A DIFFERENT VALUE IN post_perm ★
--
-- The target set is "officers AND the webmaster", and NEITHER existing bit can express it:
--
--   FORUM_POST_OFFICER (64)          officers have it; the webmaster deliberately does NOT,
--                                    because speaking for the squadron is squadron standing
--                                    (20260729200000).
--   SITE_CONFIG (2^63)               the webmaster has it; ordinary officers do not.
--
-- And post_perm is evaluated with AND semantics — (mask & required) = required — so it cannot
-- mean "either of these". Whichever single bit is chosen locks the other group out. That is
-- exactly the bug 20260729224000 was written to fix and would have re-created in mirror image.
--
-- So both groups get one shared bit.
--
-- ★ GRANTED BY WHAT A ROLE ALREADY IS, NOT BY A LIST OF NAMES ★
--
-- The WHERE clause below says "any role that can post in officer categories, plus the
-- webmaster". A hardcoded list of six rank keys would silently miss a rank added later and
-- leave a new officer unable to edit a guide, with nothing to indicate why.
UPDATE roles
SET perm_mask = perm_mask + 128
WHERE div(perm_mask, 128) % 2 = 0            -- not already granted, so this is idempotent
  AND (
    div(perm_mask, 64) % 2 = 1               -- holds FORUM_POST_OFFICER: an officer rank
    OR key = 'webmaster'                     -- runs the website
  );

-- Point the guides board at it.
--
-- Was SITE_CONFIG (2^63) as of 20260729224000, which was correct for "only the webmaster" and
-- is wrong now that officers are included. Guarded on the current value so this is idempotent
-- and will not overwrite a deliberate later change.
UPDATE forum_categories
SET post_perm = 128
WHERE slug = 'guides' AND post_perm = 9223372036854775808;
