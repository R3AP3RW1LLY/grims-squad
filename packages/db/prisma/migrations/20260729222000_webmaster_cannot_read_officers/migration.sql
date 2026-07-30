-- The webmaster cannot read the officers' board either.
--
-- Squadron owner, 2026-07-29: "officers category should only be visible to officers. non-officers
-- should not have the ability to view unless permission to a specific user is provided ... allow
-- the webmaster to see this in development env only please!"
--
-- Removes FORUM_VIEW_OFFICER (bit 4, value 16). FORUM_POST_OFFICER (64) was already removed by
-- 20260729200000; together they are SQUADRON_STANDING_PERMISSIONS — the squadron's voice and its
-- private room, neither of which is a website function.
--
-- ★ "DEV ONLY" IS DATA, NOT AN ENV BRANCH ★
--
-- There is no `if (NODE_ENV === 'development')` anywhere in the permission path, deliberately: an
-- environment branch inside an authorisation decision means production runs a path development
-- never exercises. The mask is identical everywhere, and a developer adds the grant explicitly:
--
--   pnpm --filter @grims/db dev:grant-officer-view
--
-- Production is therefore correct by DEFAULT rather than by remembering to unset something, and
-- the difference between environments is visible in the database instead of hidden in a
-- conditional.
--
-- ★ AN OFFICER-WEBMASTER IS STILL AN OFFICER ★
--
-- computeEffectiveMask ORs held roles, so somebody holding both webmaster and an officer rank
-- reads and posts on the officers' board through the RANK. Removing it from the webmaster role
-- takes nothing from a person who has earned it.
--
-- Arithmetic rather than `& ~16`: Postgres has no bitwise operator for NUMERIC, and perm_mask is
-- NUMERIC(40,0) because the mask exceeds 64 bits. `div()` is integer division — plain `/` returns
-- a fraction and silently reports the bit as clear. The WHERE guard makes this idempotent.
UPDATE roles
SET perm_mask = perm_mask - 16
WHERE key = 'webmaster'
  AND div(perm_mask, 16) % 2 = 1;
