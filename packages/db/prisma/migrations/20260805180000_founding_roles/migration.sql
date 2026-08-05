-- Founding standing becomes a role, not a list of names in the source.
--
-- ★ SQUADRON OWNER, 2026-08-04 ★
--
-- "we need to create a new tab on this page called Founders: /roster and add a
--  founders title where Pebblemerchant says webmaster it should say founder for
--  them, add only these people to that tab please! GMSD Aurelian Voss
--  (Co-Founder), Vowser (Co-Founder), Mr Grimsoul (Founder), TYCHICUS MACEDON
--  (Co-Founder) they should always be listed at the top of the all members tab
--  with Mr Grimsoul in the #1 spot, then after the founders, Pebblemerchant
--  should always be directly after them on the all members page, and should be
--  the first person listed on the Members page please!"
--
-- ★ WHY A ROLE AND NOT FIVE NAMES IN A COMPONENT ★
--
-- A hard-coded list of display names is wrong three ways at once: it breaks the
-- day somebody is renamed, it cannot be corrected without a deploy, and it puts
-- an identity claim in a file nobody reviews for identity claims (the same
-- reasoning as INV-008 for snowflakes). Founding standing is exactly what the
-- `roles` table already models — a bundle of standing, editable from
-- /app -> Roles — so it is one, and this migration only grants it.
--
-- Everything the pages read comes from these rows: the TITLE is `roles.name`,
-- and the ORDER at the top of the roster is `roles.rank_order`. Renaming
-- "Co-Founder" or reordering the pins is an edit on the roles page from now on,
-- not a code change.
--
-- ★ WHY THREE ROLES AND NOT ONE ★
--
-- Because the owner's instruction contains three different standings, and one
-- role could only carry one of them:
--
--   `founder`      Mr Grimsoul. Titled Founder, and the #1 spot outright.
--   `co_founder`   The three co-founders. Titled Co-Founder, directly after him.
--   `roster_pin`   Pebblemerchant. POSITION ONLY: directly after the founders
--                  on All members, first on the Members tab. It confers no
--                  title and puts nobody on the Founders tab.
--
--                  Squadron owner, 2026-08-05: "pebblemerchant should not have
--                  anything to do with founder in their name. i am purely the
--                  webmaster! that is it! anything else would be misconstruing
--                  this!" An earlier draft of this migration titled them
--                  Founder; that was a misreading and this is the correction.
--                  Their card says Webmaster, which is what they are.
--
-- The Founders tab lists `founder` and `co_founder`: the four the owner named,
-- and only those four. See `apps/api/src/members/founding.ts`.
--
-- ★ rank_order 800-820, AND WHY NOT 1000+ ★
--
-- Ascending, most senior first — the same direction as the leadership ladder
-- (Galactic Admiral is 10) and the reverse of the tenure one. 800-899 is a fresh
-- band below `grims_squad_members` at 900, chosen so the roles console can group
-- them as founding standing. The 1000s are the PLATFORM band, whose heading says
-- those roles "confer every permission on this site and no standing in the
-- squadron whatsoever" — the exact opposite of what these are.
--
-- ★ perm_mask 0, AND THAT IS NOT A PLACEHOLDER ★
--
-- Founding standing is honour, not authority. Every one of these five already
-- holds whatever they may do through a Discord rank or the webmaster role, and a
-- migration that quietly handed anybody a permission bundle because of a title
-- would be a privilege escalation dressed as a roster tab. The mask stays zero
-- unless somebody deliberately sets it on the roles page.
--
-- is_hierarchical false: none of these is a rung on the promotion ladder, and
-- marking one true would put it in the ladder the monthly promotion job walks.
INSERT INTO roles (id, key, name, rank_order, perm_mask, is_hierarchical, description) VALUES
  (gen_random_uuid(), 'founder', 'Founder', 800,
   0::numeric(40,0), false,
   'Founded Grim''s Squad. Listed first on the roster and on the Founders tab.'),
  (gen_random_uuid(), 'co_founder', 'Co-Founder', 810,
   0::numeric(40,0), false,
   'Co-founded Grim''s Squad. Listed on the Founders tab, directly after the founder.'),
  (gen_random_uuid(), 'roster_pin', 'Roster pin', 820,
   0::numeric(40,0), false,
   'Position only: pins a member directly after the squadron''s founders on the roster, and first on the Members tab. Confers no title and no place on the Founders tab — the card goes on showing whatever roles they actually hold.')
ON CONFLICT (key) DO NOTHING;

-- No `role_mappings` row for any of them, deliberately. There is no Discord role
-- behind founding standing, so role sync can neither grant nor revoke it, and
-- the grants below survive the nightly reconciliation because their source is
-- `system` rather than `discord` (see role-sync.service.ts).

-- ★ RESOLVED BY HANDLE, VERIFIED READ-ONLY AGAINST PRODUCTION 2026-08-04 ★
--
-- A handle is the one identifier on `users` that is unique, stable and not
-- something Discord rewrites — display names here include "Chief Vowser",
-- "Mr. Grimsoul" and "Sector Overseer - Smokeyenigma", all of which are a rank
-- prefix away from changing under us. Every handle below was read from the live
-- database before being written down, alongside its verified commander name:
--
--   mrgrimsoul          Mr. Grimsoul         CMDR Mr Grimsoul
--   mynameismike187     GMSD Aurelian Voss   CMDR GMSD Aurelian Voss
--   saintvic            Chief Vowser         CMDR Vowser
--   talenmaclir         TYCHICUS MACEDON     CMDR TYCHICUS MACEDON
--   r3ap3ractual_22545  Pebblemercahnt       CMDR PEBBLEMERCAHNT
--
-- The JOIN is what makes this safe on any database: a handle with no user row
-- grants nothing and creates nothing. On a developer machine holding only some
-- of these accounts this seeds only the ones that exist, and re-running it after
-- the rest sign in completes the set — `ON CONFLICT DO NOTHING` makes that
-- repeatable rather than a duplicate-key failure.
INSERT INTO user_roles (user_id, role_id, source)
SELECT u.id, r.id, 'system'::"RoleGrantSource"
FROM (VALUES
  ('mrgrimsoul',         'founder'),
  ('mynameismike187',    'co_founder'),
  ('saintvic',           'co_founder'),
  ('talenmaclir',        'co_founder'),
  ('r3ap3ractual_22545', 'roster_pin')
) AS g(handle, role_key)
JOIN users u ON u.handle = g.handle
JOIN roles r ON r.key = g.role_key
ON CONFLICT (user_id, role_id) DO NOTHING;
